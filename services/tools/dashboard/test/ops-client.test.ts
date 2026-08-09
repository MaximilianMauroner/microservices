import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

type FakeResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

type FetchHandler = (
  call: number,
  signal: AbortSignal
) => Promise<FakeResponse>;

type FakeEvent = {
  target: FakeElement;
  preventDefault(): void;
};

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly dataset: Record<string, string> = {};
  readonly listeners = new Map<string, Array<(event: FakeEvent) => void>>();
  readonly selectorMap = new Map<string, FakeElement>();
  className = "";
  dateTime = "";
  disabled = false;
  focused = false;
  hidden = false;
  parent: FakeElement | null = null;
  textContent = "";
  title = "";
  type = "";
  value = "";

  constructor(
    readonly tagName = "div",
    readonly fragment = false
  ) {}

  get childElementCount(): number {
    return this.children.length;
  }

  get lastElementChild(): FakeElement | null {
    return this.children.at(-1) ?? null;
  }

  addEventListener(type: string, listener: (event: FakeEvent) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      const children = node.fragment ? [...node.children] : [node];
      for (const child of children) {
        child.parent = this;
        this.children.push(child);
      }
      if (node.fragment) node.children.splice(0);
    }
  }

  click(): void {
    this.dispatch("click");
  }

  closest(selector: string): FakeElement | null {
    let current: FakeElement | null = this;
    while (current) {
      if (current.matches(selector)) return current;
      current = current.parent;
    }
    return null;
  }

  dispatch(type: string): void {
    const event = { target: this, preventDefault() {} };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  focus(): void {
    this.focused = true;
  }

  querySelector(selector: string): FakeElement | null {
    if (selector === "[data-collection-loading]:not([hidden])") {
      const loading = this.selectorMap.get("[data-collection-loading]");
      return loading && !loading.hidden ? loading : null;
    }
    const configured = this.selectorMap.get(selector);
    if (configured) return configured;
    return this.find((element) => element.matches(selector));
  }

  querySelectorAll(selector: string): FakeElement[] {
    const matches: FakeElement[] = [];
    this.visit((element) => {
      if (element.matches(selector)) matches.push(element);
    });
    return matches;
  }

  remove(): void {
    if (!this.parent) return;
    const index = this.parent.children.indexOf(this);
    if (index >= 0) this.parent.children.splice(index, 1);
    this.parent = null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  replaceChildren(...nodes: FakeElement[]): void {
    for (const child of this.children) child.parent = null;
    this.children.splice(0);
    this.append(...nodes);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
      this.dataset[key] = value;
    }
    if (name === "class") this.className = value;
    if (
      name === "name" &&
      (this instanceof FakeInput || this instanceof FakeSelect || this instanceof FakeTextArea)
    ) this.name = value;
  }

  matches(selector: string): boolean {
    return selector.split(",").some((part) => this.matchesOne(part.trim()));
  }

  private find(predicate: (element: FakeElement) => boolean): FakeElement | null {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const descendant = child.find(predicate);
      if (descendant) return descendant;
    }
    return null;
  }

  private visit(visitor: (element: FakeElement) => void): void {
    for (const child of this.children) {
      visitor(child);
      child.visit(visitor);
    }
  }

  private matchesOne(selector: string): boolean {
    let simple = selector;
    const notSelectors = [...simple.matchAll(/:not\(([^)]+)\)/g)].map((match) => match[1] ?? "");
    simple = simple.replace(/:not\([^)]+\)/g, "");
    if (notSelectors.some((notSelector) => this.matchesOne(notSelector))) return false;

    const tag = simple.match(/^[a-z]+/i)?.[0];
    if (tag && this.tagName.toLowerCase() !== tag.toLowerCase()) return false;
    for (const className of [...simple.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((match) => match[1] ?? "")) {
      if (!this.className.split(/\s+/).includes(className)) return false;
    }
    for (const attribute of simple.matchAll(/\[([^\]=]+)(?:="([^"]*)")?\]/g)) {
      const name = attribute[1] ?? "";
      const expected = attribute[2];
      const actual = this.attributeValue(name);
      if (actual === undefined || (expected !== undefined && actual !== expected)) return false;
    }
    return true;
  }

  private attributeValue(name: string): string | undefined {
    if (name === "hidden") return this.hidden ? "" : undefined;
    if (
      name === "name" &&
      (this instanceof FakeInput || this instanceof FakeSelect || this instanceof FakeTextArea)
    ) return this.name || undefined;
    if (name === "type") return this.type || undefined;
    if (name.startsWith("data-")) {
      const key = name.slice(5).replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
      return this.attributes.get(name) ?? this.dataset[key];
    }
    return this.attributes.get(name);
  }
}

class FakeButton extends FakeElement {
  constructor() {
    super("button");
  }
}

class FakeInput extends FakeElement {
  checked = false;
  name = "";

  constructor() {
    super("input");
  }
}

class FakeSelect extends FakeElement {
  name = "";

  constructor() {
    super("select");
  }
}

class FakeTextArea extends FakeElement {
  name = "";

  constructor() {
    super("textarea");
  }
}

class FakeForm extends FakeElement {
  action = "";
  method = "post";

  constructor() {
    super("form");
  }

  reset(): void {}
}

class FakeDialog extends FakeElement {
  returnValue = "";

  constructor() {
    super("dialog");
  }

  close(): void {}
  showModal(): void {}
}

class FakeDocument {
  readonly listeners = new Map<string, Array<(event: FakeEvent) => void>>();
  readonly root = new FakeElement("main");
  readonly section = new FakeElement("section");
  readonly container = new FakeElement("ol");
  readonly loading = new FakeElement("p");
  readonly error = new FakeElement("div");
  readonly errorMessage = new FakeElement("span");
  readonly more = new FakeButton();
  readonly retry = new FakeButton();
  readonly status = new FakeElement("p");

  constructor() {
    this.root.dataset.revision = "revision-1";
    this.root.dataset.opsRoot = "";
    this.section.dataset.endpoint = "/api/ops/audit";
    this.section.dataset.opsCollection = "audit";
    this.error.hidden = true;
    this.more.hidden = true;
    this.section.selectorMap.set("[data-collection-items]", this.container);
    this.section.selectorMap.set("[data-collection-loading]", this.loading);
    this.section.selectorMap.set("[data-collection-error]", this.error);
    this.section.selectorMap.set("[data-collection-error-message]", this.errorMessage);
    this.section.selectorMap.set("[data-collection-more]", this.more);
    this.section.selectorMap.set("[data-collection-retry]", this.retry);
    this.status.dataset.mutationStatus = "";
    this.status.hidden = true;
    this.root.append(this.status, this.section);
  }

  addEventListener(type: string, listener: (event: FakeEvent) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type: string, target: FakeElement): void {
    const event = { target, preventDefault() {} };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  createDocumentFragment(): FakeElement {
    return new FakeElement("fragment", true);
  }

  createElement(tagName: string): FakeElement {
    if (tagName === "button") return new FakeButton();
    if (tagName === "input") return new FakeInput();
    if (tagName === "select") return new FakeSelect();
    if (tagName === "textarea") return new FakeTextArea();
    if (tagName === "form") return new FakeForm();
    if (tagName === "dialog") return new FakeDialog();
    return new FakeElement(tagName);
  }

  getElementById(_id: string): FakeElement | null {
    return this.root.querySelector(`[id="${_id}"]`);
  }

  querySelector(selector: string): FakeElement | null {
    if (selector === "[data-ops-root]") return this.root;
    if (selector === "[data-collection-loading]:not([hidden])") {
      return this.loading.hidden ? null : this.loading;
    }
    return this.root.querySelector(selector);
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.root.querySelectorAll(selector);
  }
}

type Harness = {
  document: FakeDocument;
  signals: AbortSignal[];
  fetchCalls(): number;
};

type HarnessOptions = {
  beforeRun?: (document: FakeDocument) => void;
  session?: Record<string, string>;
};

const scriptUrl = new URL("../public/assets/ops.js", import.meta.url);

async function startHarness(handler: FetchHandler, options: HarnessOptions = {}): Promise<Harness> {
  const script = await readFile(scriptUrl, "utf8");
  const document = new FakeDocument();
  options.beforeRun?.(document);
  const signals: AbortSignal[] = [];
  let calls = 0;
  const storage = new Map<string, string>();
  for (const [key, value] of Object.entries(options.session ?? {})) storage.set(key, value);
  const sessionStorage = {
    getItem(key: string) {
      return storage.get(key) ?? null;
    },
    removeItem(key: string) {
      storage.delete(key);
    },
    setItem(key: string, value: string) {
      storage.set(key, value);
    }
  };
  const window = {
    clearTimeout,
    location: { origin: "https://tools.example.test", reload() {} },
    setTimeout
  };
  const fetch = (_url: URL, init: { signal?: AbortSignal }) => {
    if (!init.signal) throw new Error("Collection request omitted AbortSignal");
    calls += 1;
    signals.push(init.signal);
    return handler(calls, init.signal);
  };

  runInNewContext(script, {
    AbortController,
    DOMException,
    Element: FakeElement,
    FormData,
    HTMLButtonElement: FakeButton,
    HTMLDialogElement: FakeDialog,
    HTMLElement: FakeElement,
    HTMLFormElement: FakeForm,
    HTMLInputElement: FakeInput,
    HTMLSelectElement: FakeSelect,
    HTMLTextAreaElement: FakeTextArea,
    JSON,
    Map,
    Number,
    Set,
    TypeError,
    URL,
    WeakMap,
    document,
    fetch,
    sessionStorage,
    window
  });

  return { document, signals, fetchCalls: () => calls };
}

function response(status: number, payload: unknown): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    }
  };
}

function audit(id: string): Record<string, string> {
  return {
    action: `entry.update.${id}`,
    actor: "operator@example.test",
    catalogRevisionAfter: `revision-${id}`,
    occurredAt: "2026-07-28T10:00:00.000Z",
    targetType: "entry"
  };
}

function linkRow(
  document: FakeDocument,
  link: { id: string; label: string; url: string; access: string }
): FakeElement {
  const row = document.createElement("div");
  row.setAttribute("data-link-row", "");
  for (const [name, value] of Object.entries(link)) {
    const field = name === "access"
      ? document.createElement("select")
      : document.createElement("input");
    field.setAttribute("data-link-field", name);
    field.value = value;
    row.append(field);
  }
  return row;
}

function linkEditor(
  document: FakeDocument,
  link: { id: string; label: string; url: string; access: string }
): { editor: FakeElement; rows: FakeElement; textarea: FakeTextArea; row: FakeElement } {
  const editor = document.createElement("div");
  editor.setAttribute("data-link-editor", "");
  const rows = document.createElement("div");
  rows.setAttribute("data-link-rows", "");
  const row = linkRow(document, link);
  rows.append(row);
  const textarea = document.createElement("textarea") as FakeTextArea;
  textarea.setAttribute("name", "links");
  textarea.value = JSON.stringify([link]);
  editor.append(rows, textarea);
  return { editor, rows, textarea, row };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("operations collection client", () => {
  it("times out once, suppresses duplicates, and retries with a fresh controller", async () => {
    vi.useFakeTimers();
    const harness = await startHarness((call, signal) => {
      if (call === 2) return Promise.resolve(response(200, { items: [audit("retry")], nextCursor: null }));
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });

    expect(harness.fetchCalls()).toBe(1);
    harness.document.retry.click();
    await settle();
    expect(harness.fetchCalls()).toBe(1);

    await vi.advanceTimersByTimeAsync(8_000);
    await settle();
    expect(harness.signals[0]?.aborted).toBe(true);
    expect(harness.document.loading.hidden).toBe(true);
    expect(harness.document.error.hidden).toBe(false);
    expect(harness.document.errorMessage.textContent).toContain("timed out after 8 seconds");
    expect(harness.document.retry.focused).toBe(true);
    expect(harness.document.more.disabled).toBe(false);

    harness.document.retry.click();
    await settle();
    expect(harness.fetchCalls()).toBe(2);
    expect(harness.signals[1]).not.toBe(harness.signals[0]);
    expect(harness.document.error.hidden).toBe(true);
    expect(harness.document.container.childElementCount).toBe(1);
  });

  it.each([
    ["expired Access", () => Promise.resolve(response(401, {})), "Access session expired"],
    ["server failure", () => Promise.resolve(response(500, {})), "HTTP 500"],
    ["malformed JSON", () => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new SyntaxError("bad json")) }), "malformed data"],
    ["offline network", () => Promise.reject(new TypeError("offline")), "could not be reached"]
  ])("maps %s to actionable guidance", async (_name, request, expected) => {
    const harness = await startHarness(() => request());
    await settle();
    expect(harness.document.error.hidden).toBe(false);
    expect(harness.document.errorMessage.textContent).toContain(expected);
    expect(harness.document.retry.focused).toBe(true);
  });

  it("retains prior rows when loading a later page fails", async () => {
    const harness = await startHarness((call) => Promise.resolve(
      call === 1
        ? response(200, { items: [audit("first")], nextCursor: "older" })
        : response(500, {})
    ));
    await settle();
    expect(harness.document.container.childElementCount).toBe(1);
    expect(harness.document.more.hidden).toBe(false);

    harness.document.more.click();
    await settle();
    expect(harness.document.container.childElementCount).toBe(1);
    expect(harness.document.errorMessage.textContent).toContain("HTTP 500");
  });

  it("validates the complete page before append so malformed pages cannot duplicate rows", async () => {
    const harness = await startHarness((call) => Promise.resolve(response(200, {
      items: call === 1 ? [audit("valid"), { actor: "missing fields" }] : [audit("retry")],
      nextCursor: null
    })));
    await settle();
    expect(harness.document.container.childElementCount).toBe(0);
    expect(harness.document.errorMessage.textContent).toContain("malformed data");

    harness.document.retry.click();
    await settle();
    expect(harness.document.container.childElementCount).toBe(1);
  });

  it("preserves structured rows and explains invalid advanced access values", async () => {
    let controls: ReturnType<typeof linkEditor> | undefined;
    const harness = await startHarness(
      () => Promise.resolve(response(200, { items: [], nextCursor: null })),
      {
        beforeRun(document) {
          controls = linkEditor(document, {
            id: "docs",
            label: "Docs",
            url: "https://docs.example.test/",
            access: "private"
          });
          document.root.append(controls.editor);
        }
      }
    );
    await settle();
    if (!controls) throw new Error("Expected link editor controls");

    controls.textarea.value = JSON.stringify([{
      id: "docs",
      label: "Docs",
      url: "https://docs.example.test/",
      access: "members-only"
    }]);
    controls.textarea.dispatch("change");

    expect(controls.rows.children).toEqual([controls.row]);
    expect(harness.document.status.textContent).toContain(
      "access must be public, restricted, or private"
    );
    expect(controls.textarea.focused).toBe(true);
  });

  it("synchronizes valid advanced JSON and later structured edits", async () => {
    let controls: ReturnType<typeof linkEditor> | undefined;
    const harness = await startHarness(
      () => Promise.resolve(response(200, { items: [], nextCursor: null })),
      {
        beforeRun(document) {
          controls = linkEditor(document, {
            id: "old",
            label: "Old",
            url: "https://old.example.test/",
            access: "private"
          });
          document.root.append(controls.editor);
        }
      }
    );
    await settle();
    if (!controls) throw new Error("Expected link editor controls");

    controls.textarea.value = JSON.stringify([{
      id: "docs",
      label: "Docs",
      url: "https://docs.example.test/path",
      access: "private"
    }]);
    controls.textarea.dispatch("change");
    expect(controls.rows.children).toHaveLength(1);
    expect(JSON.parse(controls.textarea.value)).toEqual([{
      id: "docs",
      label: "Docs",
      url: "https://docs.example.test/path",
      access: "private"
    }]);

    const label = controls.rows.querySelector('[data-link-field="label"]');
    if (!label) throw new Error("Expected imported label field");
    label.value = "Documentation";
    harness.document.dispatch("input", label);
    expect(JSON.parse(controls.textarea.value)).toEqual([{
      id: "docs",
      label: "Documentation",
      url: "https://docs.example.test/path",
      access: "private"
    }]);
  });

  it("rejects credential-bearing structured URLs, focuses the URL, and keeps the form local", async () => {
    let form: FakeForm | undefined;
    let urlInput: FakeElement | undefined;
    const harness = await startHarness(
      () => Promise.resolve(response(200, { items: [], nextCursor: null })),
      {
        beforeRun(document) {
          form = document.createElement("form") as FakeForm;
          form.setAttribute("data-json-form", "");
          const controls = linkEditor(document, {
            id: "docs",
            label: "Docs",
            url: "https://user:secret@docs.example.test/",
            access: "private"
          });
          urlInput = controls.row.querySelector('[data-link-field="url"]') ?? undefined;
          form.append(controls.editor);
          document.root.append(form);
        }
      }
    );
    await settle();
    const collectionCalls = harness.fetchCalls();
    if (!form || !urlInput) throw new Error("Expected credential validation controls");

    harness.document.dispatch("submit", form);

    expect(harness.fetchCalls()).toBe(collectionCalls);
    expect(harness.document.status.textContent).toBe(
      "Link URLs cannot contain a username or password."
    );
    expect(urlInput.focused).toBe(true);
  });

  it("filters record buttons by search, kind, and active state", async () => {
    let search: FakeInput | undefined;
    let kind: FakeSelect | undefined;
    let state: FakeSelect | undefined;
    let activePage: FakeButton | undefined;
    let inactiveFile: FakeButton | undefined;
    await startHarness(
      () => Promise.resolve(response(200, { items: [], nextCursor: null })),
      {
        beforeRun(document) {
          search = document.createElement("input") as FakeInput;
          search.setAttribute("data-record-search", "");
          kind = document.createElement("select") as FakeSelect;
          kind.setAttribute("data-record-kind", "");
          kind.value = "all";
          state = document.createElement("select") as FakeSelect;
          state.setAttribute("data-record-status", "");
          state.value = "all";
          activePage = document.createElement("button") as FakeButton;
          activePage.className = "record-button";
          activePage.dataset.recordSearch = "launch plan";
          activePage.dataset.recordKind = "html";
          activePage.dataset.recordStatus = "active";
          inactiveFile = document.createElement("button") as FakeButton;
          inactiveFile.className = "record-button";
          inactiveFile.dataset.recordSearch = "archive notes";
          inactiveFile.dataset.recordKind = "file";
          inactiveFile.dataset.recordStatus = "inactive expiring";
          document.root.append(search, kind, state, activePage, inactiveFile);
        }
      }
    );
    await settle();
    if (!search || !kind || !state || !activePage || !inactiveFile) {
      throw new Error("Expected record filter controls");
    }

    search.value = "archive";
    search.dispatch("input");
    expect(activePage.hidden).toBe(true);
    expect(inactiveFile.hidden).toBe(false);

    search.value = "";
    kind.value = "html";
    state.value = "inactive";
    state.dispatch("change");
    expect(activePage.hidden).toBe(true);
    expect(inactiveFile.hidden).toBe(true);
  });

  it("restores the selected editor, preserves edits across selection, and announces moves", async () => {
    let firstPanel: FakeElement | undefined;
    let secondPanel: FakeElement | undefined;
    let firstButton: FakeButton | undefined;
    let secondButton: FakeButton | undefined;
    let firstInput: FakeInput | undefined;
    let secondInput: FakeInput | undefined;
    const harness = await startHarness(
      () => Promise.resolve(response(200, { items: [], nextCursor: null })),
      {
        session: {
          "ops:selected": "second",
          "ops:announcement": "Moved Archive to position 2 of 3"
        },
        beforeRun(document) {
          firstPanel = document.createElement("section");
          firstPanel.dataset.editorPanel = "first";
          firstInput = document.createElement("input") as FakeInput;
          firstPanel.append(firstInput);
          secondPanel = document.createElement("section");
          secondPanel.dataset.editorPanel = "second";
          secondPanel.hidden = true;
          secondInput = document.createElement("input") as FakeInput;
          secondPanel.append(secondInput);
          firstButton = document.createElement("button") as FakeButton;
          firstButton.dataset.editorTarget = "first";
          secondButton = document.createElement("button") as FakeButton;
          secondButton.dataset.editorTarget = "second";
          document.root.append(firstButton, secondButton, firstPanel, secondPanel);
        }
      }
    );
    await settle();
    if (!firstPanel || !secondPanel || !firstButton || !secondButton || !firstInput || !secondInput) {
      throw new Error("Expected editor selection controls");
    }

    expect(firstPanel.hidden).toBe(true);
    expect(secondPanel.hidden).toBe(false);
    expect(secondInput.focused).toBe(true);
    expect(harness.document.status.textContent).toBe("Moved Archive to position 2 of 3");
    expect(harness.document.status.className).toContain("notice--success");

    secondInput.value = "unfinished edit";
    harness.document.dispatch("click", firstButton);
    harness.document.dispatch("click", secondButton);
    expect(secondInput.value).toBe("unfinished edit");
  });
});

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

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly dataset: Record<string, string> = {};
  readonly listeners = new Map<string, Array<() => void>>();
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

  addEventListener(type: string, listener: () => void): void {
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
    for (const listener of this.listeners.get("click") ?? []) listener();
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
    if (selector === "[data-collection-empty]") {
      return this.find((element) => element.attributes.has("data-collection-empty"));
    }
    return null;
  }

  querySelectorAll(_selector: string): FakeElement[] {
    return [];
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

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  private find(predicate: (element: FakeElement) => boolean): FakeElement | null {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const descendant = child.find(predicate);
      if (descendant) return descendant;
    }
    return null;
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
  constructor() {
    super("select");
  }
}

class FakeTextArea extends FakeElement {
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
  readonly root = new FakeElement("main");
  readonly section = new FakeElement("section");
  readonly container = new FakeElement("ol");
  readonly loading = new FakeElement("p");
  readonly error = new FakeElement("div");
  readonly errorMessage = new FakeElement("span");
  readonly more = new FakeButton();
  readonly retry = new FakeButton();

  constructor() {
    this.root.dataset.revision = "revision-1";
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
  }

  addEventListener(_type: string, _listener: () => void): void {}

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
    return null;
  }

  querySelector(selector: string): FakeElement | null {
    if (selector === "[data-ops-root]") return this.root;
    if (selector === "[data-collection-loading]:not([hidden])") {
      return this.loading.hidden ? null : this.loading;
    }
    return null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    return selector === "[data-ops-collection]" ? [this.section] : [];
  }
}

type Harness = {
  document: FakeDocument;
  signals: AbortSignal[];
  fetchCalls(): number;
};

const scriptUrl = new URL("../public/assets/ops.js", import.meta.url);

async function startHarness(handler: FetchHandler): Promise<Harness> {
  const script = await readFile(scriptUrl, "utf8");
  const document = new FakeDocument();
  const signals: AbortSignal[] = [];
  let calls = 0;
  const storage = new Map<string, string>();
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
});

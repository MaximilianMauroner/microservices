// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ManagePage } from "../publisher/ui/manage-page.js";
import type { ManagePageData, UploadSummary } from "../src/protected-data.js";

const viewport = vi.hoisted(() => ({ mobile: false }));
const directUpload = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock("../src/components/ui/use-mobile.js", () => ({ useIsMobile: () => viewport.mobile }));
vi.mock("../publisher/ui/direct-upload.js", () => ({ uploadDirectFile: directUpload.upload }));
vi.mock("../src/components/form-controls.js", () => ({
  AppSelect: ({ options, onValueChange, ...props }: { options: Array<{ value: string; label: string }>; onValueChange: (value: string) => void }) =>
    <select {...props} onChange={(event) => onValueChange(event.currentTarget.value)}>{options.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select>
}));

const upload: UploadSummary = {
  id: "a".repeat(32), kind: "file", filename: "loaded.txt", contentType: "text/plain", category: "documents",
  url: "https://tools.example.test/files/loaded.txt", bytes: 2048, updatedAt: "2026-10-17T12:00:00.000Z"
};
const initial: ManagePageData = {
  uploads: [upload], nextCursor: "initial-cursor",
  summary: { total: 200, activeBytes: 1073741824, permanent: 200, temporary: 0, expiringSoon: 0,
    projects: [{ project: null, count: 190 }, { project: "work", count: 10 }] }
};

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); viewport.mobile = false; });

it("requests current criteria across the full library, appends compatible pages, and ignores stale reads", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const requests: Array<{ url: URL; signal: AbortSignal; finish: (data: ManagePageData) => void }> = [];
  vi.stubGlobal("fetch", vi.fn((path: string, init: RequestInit) => path === "/health/publisher" ?
    Promise.resolve(Response.json({ ok: true })) : new Promise<Response>((resolve) => {
    requests.push({ url: new URL(path, "https://tools.example.test"), signal: init.signal as AbortSignal,
      finish: (data) => resolve(Response.json(data)) });
  })));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const select = async (label: string, value: string) => act(async () => {
    const node = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
    node.value = value;
    node.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === text)!;
  try {
    await act(async () => root.render(<ManagePage initial={initial} />));
    expect(requests).toHaveLength(0);
    await select("Project", "work");
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url.searchParams.get("project")).toBe("named");
    expect(requests[0]!.url.searchParams.get("projectName")).toBe("work");
    expect(requests[0]!.url.searchParams.has("cursor")).toBe(false);
    await select("File category", "pdf");
    expect(requests[0]!.signal.aborted).toBe(true);
    expect(requests).toHaveLength(2);
    await act(async () => requests[1]!.finish({ uploads: [{ ...upload, filename: "outside-loaded-page.pdf", category: "pdf" }], nextCursor: "pdf-cursor" }));
    expect(host.textContent).toContain("outside-loaded-page.pdf");
    expect(host.textContent).toContain("1 matches loaded");
    expect(host.textContent).not.toContain("of 200 loaded");
    await act(async () => requests[0]!.finish({ uploads: [{ ...upload, filename: "stale.txt" }], nextCursor: "stale-cursor" }));
    expect(host.textContent).not.toContain("stale.txt");
    await act(async () => button("Load more artifacts").click());
    const continuation = requests.at(-1)!;
    expect(Object.fromEntries(continuation.url.searchParams)).toMatchObject({ project: "named", projectName: "work", category: "pdf", kind: "all", expiry: "all", sort: "newest", q: "", cursor: "pdf-cursor" });
    expect(continuation.url.searchParams.has("includeSummary")).toBe(false);
    await act(async () => continuation.finish({ uploads: [{ ...upload, id: "b".repeat(32), filename: "second-page.pdf", category: "pdf" }] }));
    expect(host.textContent).toContain("outside-loaded-page.pdf");
    expect(host.textContent).toContain("second-page.pdf");
    expect(host.textContent).toContain("2 matches");
    expect(host.textContent).not.toContain("2 matches loaded");
    const secondPageRow = [...host.querySelectorAll("tr")].find((row) => row.textContent?.includes("second-page.pdf"))!;
    await act(async () => secondPageRow.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(host.textContent).toContain("1 selected");
    await act(async () => button("Refresh").click());
    await act(async () => requests.at(-1)!.finish({ uploads: [{ ...upload, filename: "outside-loaded-page.pdf", category: "pdf" }], nextCursor: "pdf-cursor" }));
    expect(host.textContent).not.toContain("1 selected");
    await select("Sort artifacts", "size");
    expect(requests.at(-1)!.url.searchParams.get("sort")).toBe("size");
    expect(requests.at(-1)!.url.searchParams.has("cursor")).toBe(false);
    await act(async () => requests.at(-1)!.finish({ uploads: [] }));
    await act(async () => button("Files").click());
    expect(requests.at(-1)!.url.searchParams.get("kind")).toBe("file");
    await act(async () => requests.at(-1)!.finish({ uploads: [] }));
    await act(async () => button("Next 7 days").click());
    expect(requests.at(-1)!.url.searchParams.get("expiry")).toBe("7d");
    await act(async () => requests.at(-1)!.finish({ uploads: [] }));
    await act(async () => {
      const input = host.querySelector<HTMLInputElement>('input[aria-label="Search artifacts"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, " older report ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 275)); });
    expect(Object.fromEntries(requests.at(-1)!.url.searchParams)).toMatchObject({ q: "older report", kind: "file", project: "named", projectName: "work", expiry: "7d", category: "pdf", sort: "size", includeSummary: "true" });
    await act(async () => requests.at(-1)!.finish({ uploads: [{ ...upload, filename: "older report.pdf", category: "pdf" }] }));
    expect(host.textContent).toContain("older report.pdf");
    expect([...host.querySelectorAll("tbody strong")].map((node) => node.textContent)).toEqual(["older report.pdf"]);
    expect(requests).toHaveLength(8);
    await select("File category", "video");
    const discarded = requests.at(-1)!;
    await select("File category", "pdf");
    expect(discarded.signal.aborted).toBe(true);
    expect(requests).toHaveLength(10);
    expect(requests.at(-1)!.url.searchParams.get("category")).toBe("pdf");
    await act(async () => requests.at(-1)!.finish({ uploads: [{ ...upload, filename: "restored.pdf" }] }));
    expect(host.textContent).toContain("restored.pdf");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it.each(["success", "failure"] as const)("refreshes the current criteria after an update completes with reload %s", async (outcome) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const requests: Array<{ url: URL; signal: AbortSignal; finish: (data: ManagePageData | Response) => void }> = [];
  vi.stubGlobal("fetch", vi.fn((path: string, init: RequestInit) => path === "/health/publisher" ?
    Promise.resolve(Response.json({ ok: true })) : new Promise<Response>((resolve) => {
    requests.push({ url: new URL(path, "https://tools.example.test"), signal: init.signal as AbortSignal,
      finish: (data) => resolve(data instanceof Response ? data : Response.json(data)) });
  })));
  let finishUpload!: (upload: UploadSummary) => void;
  directUpload.upload.mockReturnValue(new Promise<UploadSummary>((resolve) => { finishUpload = resolve; }));
  const html = { ...upload, kind: "html" as const, filename: "plan.html", contentType: "text/html", category: "html" as const };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ManagePage initial={{ ...initial, uploads: [html] }} />));
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Choose replacement HTML file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["new"], "plan.html", { type: "text/html" })] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    const category = host.querySelector<HTMLSelectElement>('select[aria-label="File category"]')!;
    await act(async () => { category.value = "pdf"; category.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(requests).toHaveLength(1);
    await act(async () => { finishUpload(html); });
    expect(requests[0]!.signal.aborted).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests[1]!.url.searchParams.get("category")).toBe("pdf");
    await act(async () => requests[1]!.finish(outcome === "success"
      ? { uploads: [{ ...upload, filename: "current.pdf", category: "pdf" }] }
      : Response.json({}, { status: 400 })));
    if (outcome === "success") {
      expect(host.textContent).toContain("current.pdf");
      expect(host.textContent).toContain("replaced the artifact without changing its URL");
    } else {
      expect(host.textContent).toContain("Artifact inventory could not be loaded.");
      expect(host.textContent).not.toContain("replaced the artifact without changing its URL");
    }
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("shows each mobile row size and the total active storage", async () => {
  viewport.mobile = true;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ManagePage initial={initial} />));
    expect(host.querySelector('[role="listitem"]')?.textContent).toContain("2.0 KB");
    expect(host.textContent).toContain("1.0 GB active storage");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

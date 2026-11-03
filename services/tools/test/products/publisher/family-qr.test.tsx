// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { FamilyQrPage } from "../../../products/publisher/ui/family-qr-page.js";
import { familyQrFile } from "../../../products/publisher/ui/family-qr.js";
import { uploadDirectFile } from "../../../products/publisher/ui/direct-upload.js";
import type { UploadSummary } from "../../../platform/protected-data.js";

vi.mock("../../../products/publisher/ui/direct-upload.js", () => ({ uploadDirectFile: vi.fn() }));

const shared: UploadSummary = {
  id: "a".repeat(32), kind: "html", filename: "family-qr.html", contentType: "text/html", category: "html",
  url: `https://tools.example/artifacts/${"a".repeat(32)}`, bytes: 100, project: "Family QR", updatedAt: "2026-11-02T12:00:00.000Z"
};
const screenshot = () => new File([Uint8Array.from([137, 80, 78, 71])], "qr.png", { type: "image/png" });
const readText = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = reject;
  reader.readAsText(file);
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("publishes a self-contained image with an upload time, expiry warning, and refresh", async () => {
  const html = await readText(await familyQrFile(screenshot()));
  const doc = new DOMParser().parseFromString(html, "text/html");
  expect(doc.querySelector("img")?.src).toBe("data:image/png;base64,iVBORw==");
  expect(doc.querySelector<HTMLMetaElement>('meta[http-equiv="refresh"]')?.content).toBe("3");
  expect(Date.parse(doc.querySelector("time")!.dateTime)).toBeGreaterThan(0);
  expect(doc.body.textContent).toContain("Spotify may have already expired this code");
  expect(doc.querySelectorAll("script,iframe")).toHaveLength(0);
});

it("rejects active image formats and oversized or empty screenshots before publishing", async () => {
  await expect(familyQrFile(new File(["<svg onload='alert(1)'/>"], "qr.svg", { type: "image/svg+xml" }))).rejects.toThrow("PNG, JPEG, or WebP");
  await expect(familyQrFile(new File([new Uint8Array(4 * 1024 * 1024 + 1)], "qr.png", { type: "image/png" }))).rejects.toThrow("4 MB");
  await expect(familyQrFile(new File([], "qr.png", { type: "image/png" }))).rejects.toThrow("4 MB");
  expect(uploadDirectFile).not.toHaveBeenCalled();
});

it.each([null, shared])("creates or restores a share link, then keeps it through a replacement and failed upload", async initial => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(uploadDirectFile).mockResolvedValue(shared);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const choose = () => {
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [screenshot()] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const waitForUpload = async (calls: number) => {
    await act(async () => {
      choose();
      await vi.waitFor(() => expect(uploadDirectFile).toHaveBeenCalledTimes(calls));
    });
  };
  try {
    await act(async () => root.render(<FamilyQrPage initial={initial} />));
    if (initial) expect(host.querySelector<HTMLInputElement>("#family-qr-link")?.value).toBe(shared.url);
    await waitForUpload(1);
    expect(vi.mocked(uploadDirectFile).mock.calls[0]?.[2]).toEqual({ kind: "html", project: "Family QR", ...(initial ? { replaceId: shared.id } : {}) });
    const link = () => host.querySelector<HTMLInputElement>("#family-qr-link")?.value;
    expect(link()).toBe(shared.url);
    await waitForUpload(2);
    expect(vi.mocked(uploadDirectFile).mock.calls[1]?.[2]).toMatchObject({ replaceId: shared.id });
    expect(link()).toBe(shared.url);
    vi.mocked(uploadDirectFile).mockRejectedValueOnce(new Error("The upload failed."));
    await waitForUpload(3);
    expect(host.textContent).toContain("The upload failed.");
    expect(link()).toBe(shared.url);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

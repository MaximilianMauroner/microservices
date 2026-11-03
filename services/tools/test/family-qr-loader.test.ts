import { beforeEach, expect, it, vi } from "vitest";
import type { UploadSummary } from "../src/protected-data.js";

const { inventory, middleware } = vi.hoisted(() => ({ inventory: [] as UploadSummary[], middleware: {} }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({ middleware: (guards: unknown[]) => ({
    handler: (handler: () => Promise<unknown>) => Object.assign(handler, { guards }),
    validator: () => ({ handler: () => {} })
  }) })
}));
vi.mock("../src/auth-middleware.js", () => ({
  requirePlatformSession: {},
  requireProductAccess: (product: string) => product === "publisher" ? middleware : {}
}));
vi.mock("../src/server-data.js", () => ({
  internalPlatformRequest: () => ({ context: { runtime: { services: { publisher: { handle: vi.fn() } } } } }),
  readPlatformResponse: vi.fn(),
  readPlatformJson: async (_handler: unknown, pathname: string) => {
    const query = new URL(pathname, "https://tools.example").searchParams;
    const uploads = inventory.filter(item => item.kind === query.get("kind") && item.filename.includes(query.get("q") ?? "")
      && (query.get("project") !== "named" || item.project === query.get("projectName")));
    uploads.sort((a, b) => (query.get("sort") === "oldest" ? 1 : -1) * a.updatedAt.localeCompare(b.updatedAt));
    return { uploads };
  }
}));

import { getFamilyQrPageData } from "../src/protected-data.js";

const original: UploadSummary = { id: "a".repeat(32), kind: "html", filename: "family-qr.html", category: "html",
  contentType: "text/html", bytes: 100, project: "Family QR", url: "https://tools.example/artifacts/original", updatedAt: "2026-11-01T12:00:00.000Z" };

beforeEach(() => { inventory.splice(0); });

it("restores the same link after Library moves its project and changes its update time", async () => {
  inventory.push({ ...original });
  expect(await getFamilyQrPageData()).toMatchObject({ id: original.id });
  inventory[0]!.project = "Personal";
  inventory[0]!.updatedAt = "2026-11-02T12:00:00.000Z";
  expect(await getFamilyQrPageData()).toMatchObject({ id: original.id, url: original.url });
  expect((getFamilyQrPageData as unknown as { guards: unknown[] }).guards).toEqual([middleware]);
});

it("refuses an ambiguous duplicate rather than switching the permanent link", async () => {
  inventory.push({ ...original, project: "Personal", updatedAt: "2026-11-03T12:00:00.000Z" },
    { ...original, id: "b".repeat(32), url: "https://tools.example/artifacts/newer", updatedAt: "2026-11-02T12:00:00.000Z" });
  await expect(getFamilyQrPageData()).rejects.toThrow("Multiple Family QR pages exist");
});

it("returns no link when there is no exact Family QR artifact", async () => {
  inventory.push({ ...original, filename: "old-family-qr.html" });
  expect(await getFamilyQrPageData()).toBeNull();
});

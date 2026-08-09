import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { assertOperationOwnership, pageArtifactMetadata, runDurableMutation } from "../src/postgres-storage.js";
import { vi } from "vitest";
import { artifactId } from "../src/artifact-backfill.js";

const now = new Date("2026-08-09T12:00:00.000Z");
const uploads = [
  { id: "a", key: "pages/a.html", kind: "html" as const, originalName: "Plan.html", contentType: "text/html", bytes: 12, updatedAt: new Date("2026-08-09T11:00:00.000Z"), project: "microservices" },
  { id: "b", key: "files/b", kind: "file" as const, originalName: "build.zip", contentType: "application/zip", bytes: 24, updatedAt: new Date("2026-08-09T10:00:00.000Z"), expiresAt: new Date("2026-08-10T10:00:00.000Z") },
  { id: "c", key: "files/c", kind: "file" as const, originalName: "later.zip", contentType: "application/zip", bytes: 48, updatedAt: new Date("2026-08-09T09:00:00.000Z"), expiresAt: new Date("2026-08-20T10:00:00.000Z") }
];

describe("Postgres artifact metadata paging", () => {
  it("preserves canonical IDs while rejecting unrelated bucket objects", () => {
    const id = "a".repeat(32);
    expect(artifactId(`pages/${id}.html`, "pages/")).toBe(id);
    expect(artifactId(`files/${id}`, "files/")).toBe(id);
    expect(artifactId("pages/notes.html", "pages/")).toBeUndefined();
  });
  it("filters authoritative metadata without inspecting S3", () => {
    const page = pageArtifactMetadata(uploads, now, { limit: 10, kind: "file", q: "BUILD", expiry: "24h", sort: "filename" });
    expect(page.uploads.map(({ id }) => id)).toEqual(["b"]);
  });

  it("preserves stable cursor ordering", () => {
    const first = pageArtifactMetadata(uploads, now, { limit: 1, sort: "newest", criteria: "newest" });
    expect(first.uploads[0]?.id).toBe("a");
    expect(first.nextCursor).toMatchObject({ key: "pages/a.html", criteria: "newest" });
    const second = pageArtifactMetadata(uploads, now, { limit: 1, sort: "newest", criteria: "newest", cursor: first.nextCursor });
    expect(second.uploads[0]?.id).toBe("b");
  });

  it("keeps persistent artifacts separate from expiring files", () => {
    const page = pageArtifactMetadata(uploads, now, { limit: 10, expiry: "persistent" });
    expect(page.uploads.map(({ id }) => id)).toEqual(["a"]);
  });

  it("retains the durable operation when metadata finalization fails", async () => {
    const events: string[] = [];
    await expect(runDurableMutation({
      prepare: async () => { events.push("prepared"); return { operationId: "operation", ownerId: "owner" }; },
      mutate: async () => { events.push("body-written"); },
      reconcile: vi.fn(),
      finalize: async () => { events.push("finalize-attempted"); throw new Error("database unavailable"); }
    })).rejects.toThrow("database unavailable");
    expect(events).toEqual(["prepared", "body-written", "finalize-attempted"]);
  });

  it("reconciles an ambiguous S3 failure before returning it", async () => {
    const original = new Error("S3 response lost");
    const reconcile = vi.fn(async () => {});
    await expect(runDurableMutation({
      prepare: async () => ({ operationId: "operation", ownerId: "owner" }),
      mutate: async () => { throw original; },
      reconcile,
      finalize: vi.fn()
    })).rejects.toBe(original);
    expect(reconcile).toHaveBeenCalledWith({ operationId: "operation", ownerId: "owner" });
  });

  it("rejects metadata finalization after operation ownership changes", () => {
    expect(() => assertOperationOwnership(false, "operation")).toThrow("no longer owned");
    expect(() => assertOperationOwnership(true, "operation")).not.toThrow();
  });

  it("claims only expired operations and locks ownership during finalization", async () => {
    const source = await readFile(new URL("../src/postgres-storage.ts", import.meta.url), "utf8");
    const migration = await readFile(new URL("../../database/003_artifact_operations.sql", import.meta.url), "utf8");
    expect(source).toContain("where lease_until <= now()");
    expect(source).toContain("and owner_id = ${operation.ownerId} for update");
    expect(migration).toContain("unique index if not exists artifact_operations_artifact_idx");
  });
});

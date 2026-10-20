import { DEFAULT_UPLOAD_LIST_CRITERIA, serializeUploadListCriteria } from "../src/upload-list.js";
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { assertOperationOwnership, createMetadataBackedUploadStorage, pageArtifactMetadata, runDurableMutation } from "../src/postgres-storage.js";
import { vi } from "vitest";
import { artifactId } from "../src/artifact-backfill.js";

const now = new Date("2026-08-09T12:00:00.000Z");
const uploads = [
  { id: "a", key: "pages/a.html", kind: "html" as const, originalName: "Plan.html", contentType: "text/html", bytes: 12, updatedAt: new Date("2026-08-09T11:00:00.000Z"), project: "microservices" },
  { id: "b", key: "files/b", kind: "file" as const, originalName: "build.zip", contentType: "application/zip", bytes: 24, updatedAt: new Date("2026-08-09T10:00:00.000Z"), expiresAt: new Date("2026-08-10T10:00:00.000Z") },
  { id: "c", key: "files/c", kind: "file" as const, originalName: "later.zip", contentType: "application/zip", bytes: 48, updatedAt: new Date("2026-08-09T09:00:00.000Z"), expiresAt: new Date("2026-08-20T10:00:00.000Z") },
  { id: "d", key: "files/d", kind: "file" as const, originalName: "permanent.zip", contentType: "application/zip", bytes: 64, updatedAt: new Date("2026-08-09T08:00:00.000Z") }
];

describe("Postgres artifact metadata paging", () => {
  it("preserves canonical IDs while rejecting unrelated bucket objects", () => {
    const id = "a".repeat(32);
    expect(artifactId(`pages/${id}.html`, "pages/")).toBe(id);
    expect(artifactId(`files/${id}`, "files/")).toBe(id);
    expect(artifactId("pages/notes.html", "pages/")).toBeUndefined();
  });
  it("filters authoritative metadata without inspecting S3", () => {
    const page = pageArtifactMetadata(uploads, now, { limit: 10, criteria: { ...DEFAULT_UPLOAD_LIST_CRITERIA, kind: "file", q: "BUILD", expiry: "24h", sort: "filename" } });
    expect(page.uploads.map(({ id }) => id)).toEqual(["b"]);
  });

  it("searches project names and capability IDs", () => {
    const byProject = pageArtifactMetadata(uploads, now, { limit: 10,
      criteria: { ...DEFAULT_UPLOAD_LIST_CRITERIA, q: "MICROSERVICES" } });
    const byId = pageArtifactMetadata([{ ...uploads[0]!, id: "capability-token-123" }], now, { limit: 10,
      criteria: { ...DEFAULT_UPLOAD_LIST_CRITERIA, q: "TOKEN-123" } });
    expect(byProject.uploads.map(({ id }) => id)).toEqual(["a"]);
    expect(byId.uploads.map(({ id }) => id)).toEqual(["capability-token-123"]);
  });

  it("preserves stable cursor ordering", () => {
    const first = pageArtifactMetadata(uploads, now, { limit: 1, criteria: DEFAULT_UPLOAD_LIST_CRITERIA });
    expect(first.uploads[0]?.id).toBe("a");
    expect(first.nextCursor).toMatchObject({ key: "pages/a.html", criteria: serializeUploadListCriteria(DEFAULT_UPLOAD_LIST_CRITERIA) });
    const second = pageArtifactMetadata(uploads, now, { limit: 1, criteria: DEFAULT_UPLOAD_LIST_CRITERIA, cursor: first.nextCursor });
    expect(second.uploads[0]?.id).toBe("b");
  });

  it("reports full inventory totals independently of the page size", () => {
    const page = pageArtifactMetadata(uploads, now, { limit: 1, includeSummary: true });
    expect(page.uploads).toHaveLength(1);
    expect(page.summary).toEqual({
      total: 4,
      activeBytes: 148,
      permanent: 2,
      temporary: 2,
      expiringSoon: 1,
      projects: [
        { project: "microservices", count: 1 },
        { project: null, count: 3 }
      ]
    });
  });

  it("keeps permanent artifacts separate from expiring files", () => {
    const page = pageArtifactMetadata(uploads, now, { limit: 10, criteria: { ...DEFAULT_UPLOAD_LIST_CRITERIA, expiry: "persistent" } });
    expect(page.uploads.map(({ id }) => id)).toEqual(["a", "d"]);
  });

  it("sums active canonical bytes before filters and pagination", () => {
    const expired = { ...uploads[1]!, id: "expired", bytes: 1000, expiresAt: now };
    const page = pageArtifactMetadata([...uploads, expired], now, { limit: 1, includeSummary: true,
      criteria: { ...DEFAULT_UPLOAD_LIST_CRITERIA, project: { mode: "unassigned" }, category: "archives" } });
    expect(page.uploads.map((item) => item.id)).toEqual(["b"]);
    expect(page.summary).toMatchObject({ total: 4, activeBytes: 148 });
  });

  it.each([
    ["text/html; charset=utf-8", "plan.bin", "html"],
    ["application/xhtml+xml", "plan.bin", "html"],
    ["application/pdf", "report.bin", "pdf"],
    ["image/png", "photo.bin", "images"],
    ["video/mp4", "movie.bin", "video"],
    ["audio/mpeg", "song.bin", "audio"],
    ["application/zip", "backup.bin", "archives"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "notes.bin", "documents"],
    ["text/plain", "notes.bin", "documents"],
    ["application/json", "report.pdf", "pdf"],
    ["application/x-zip-compressed", "backup.zip", "archives"],
    ["application/x-unrecognized", "backup.rar", "archives"],
    ["application/octet-stream", "PLAN.HTML", "html"],
    ["application/octet-stream", "REPORT.PDF", "pdf"],
    ["", "photo.JPG", "images"],
    ["binary/octet-stream", "movie.MOV", "video"],
    ["application/octet-stream", "song.mp3", "audio"],
    ["application/octet-stream", "backup.tar.gz", "archives"],
    ["application/octet-stream", "notes.docx", "documents"],
    ["application/octet-stream", "unknown.bin", "other"]
  ] as const)("classifies %s with filename %s as %s", (contentType, originalName, category) => {
    const row = { ...uploads[0]!, contentType, originalName, bytes: 0 };
    const page = pageArtifactMetadata([row], now, { limit: 1, includeSummary: true,
      criteria: { ...DEFAULT_UPLOAD_LIST_CRITERIA, category } });
    expect(page.uploads).toMatchObject([{ originalName, category, bytes: 0 }]);
    expect(page.summary?.activeBytes).toBe(0);
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
    const schema = await readFile(new URL("../../database/postgres-schema.ts", import.meta.url), "utf8");
    expect(source).toContain("where lease_until <= now()");
    expect(source).toContain("and owner_id = ${operation.ownerId} for update");
    expect(schema).toContain('uniqueIndex("artifact_operations_artifact_idx")');
  });

  it("finalizes guest artifacts only while their upload link is active", async () => {
    const source = await readFile(new URL("../src/postgres-storage.ts", import.meta.url), "utf8");

    expect(source).toContain("where id = ${uploadLinkId}::uuid and revoked_at is null and expires_at > now()");
    expect(source).toContain("for update`");
    expect(source).toContain("set operation_kind = 'delete', payload = null");
    expect(source).toContain("await finalizeDelete(sql, operationOwner, operation.artifact_id)");
    expect(source).toContain("throw new UploadLinkInactiveError()");
  });
});

describe("Ranged temporary file reads", () => {
  const total = 123_569_134;
  const row = {
    id: "file-id", kind: "file", filename: "lecture.mp4", content_type: "video/mp4",
    bytes: String(total), object_key: "files/file-id", project: null,
    created_at: now, updated_at: now, expires_at: null
  };
  const fakeSql = (() => {
    const sql = async (strings: TemplateStringsArray) => {
      const text = strings.join("?");
      if (text.includes("artifacts.operations")) return [];
      if (text.includes("from artifacts.objects")) return [row];
      return [];
    };
    return sql as unknown as Parameters<typeof createMetadataBackedUploadStorage>[1];
  })();

  const bodiesReturning = (slice: { bytes: number; contentRange?: string }) =>
    ({
      async getTemporaryFile() {
        return {
          body: Readable.from(Buffer.alloc(0)),
          bytes: slice.bytes,
          contentType: "application/octet-stream",
          originalName: "stored.bin",
          sha256: "a".repeat(64),
          lastModified: now,
          ...(slice.contentRange ? { contentRange: slice.contentRange } : {})
        };
      }
    }) as unknown as Parameters<typeof createMetadataBackedUploadStorage>[0];

  it("reports the slice length, so Content-Length matches Content-Range", async () => {
    const storage = createMetadataBackedUploadStorage(
      bodiesReturning({ bytes: 8192, contentRange: `bytes 0-8191/${total}` }),
      fakeSql
    );
    const file = await storage.getTemporaryFile("file-id", { range: "bytes=0-8191" });
    expect(file?.bytes).toBe(8192);
    expect(file?.contentRange).toBe(`bytes 0-8191/${total}`);
  });

  it("reports the full artifact size when the read is not ranged", async () => {
    const storage = createMetadataBackedUploadStorage(bodiesReturning({ bytes: total }), fakeSql);
    const file = await storage.getTemporaryFile("file-id", {});
    expect(file?.bytes).toBe(total);
  });
});

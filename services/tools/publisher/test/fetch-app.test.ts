import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { ActivityTracker } from "../src/activity-tracker.js";
import { createFetchApp } from "../src/fetch-app.js";
import type { CreatedUploadLink, UploadLink, UploadLinkRepository } from "../src/upload-links.js";
import type {
  GetStoredObjectOptions,
  GetTemporaryFileOptions,
  ListUploadsOptions,
  PutHtmlMetadata,
  PutHtmlOptions,
  PutTemporaryFileMetadata,
  StorageOperationOptions,
  StoredHtml,
  StoredTemporaryFile,
  StoredUploadPage,
  UploadStorage
} from "../src/storage.js";

class MemoryUploadStorage implements UploadStorage {
  readonly pages = new Map<string, { body: Buffer; metadata: PutHtmlMetadata }>();
  readonly files = new Map<string, { body: Buffer; metadata: Omit<PutTemporaryFileMetadata, "expiresAt"> & { expiresAt?: Date } }>();

  async putHtml(id: string, filePath: string, metadata: PutHtmlMetadata, _options?: PutHtmlOptions) {
    this.pages.set(id, { body: await readFile(filePath), metadata });
  }

  async getHtml(id: string, options?: GetStoredObjectOptions): Promise<StoredHtml | null> {
    const page = this.pages.get(id);
    if (!page) return null;
    return {
      body: Readable.from(options?.headOnly ? [] : [page.body]),
      bytes: page.body.length,
      etag: `"sha256-${page.metadata.sha256}"`,
      sha256: page.metadata.sha256,
      lastModified: new Date("2026-01-01T00:00:00.000Z"),
      ...(page.metadata.project ? { project: page.metadata.project } : {})
    };
  }

  async putTemporaryFile(id: string, filePath: string, metadata: PutTemporaryFileMetadata) {
    this.files.set(id, { body: await readFile(filePath), metadata });
  }

  async getTemporaryFile(id: string, options?: GetTemporaryFileOptions): Promise<StoredTemporaryFile | null> {
    const file = this.files.get(id);
    if (!file) return null;
    return {
      body: Readable.from(options?.headOnly ? [] : [file.body]),
      bytes: file.body.length,
      contentType: file.metadata.contentType,
      originalName: file.metadata.originalName,
      ...(file.metadata.expiresAt ? { expiresAt: file.metadata.expiresAt } : {}),
      sha256: file.metadata.sha256,
      lastModified: new Date("2026-01-01T00:00:00.000Z")
    };
  }

  async listUploads(_asOf: Date, _options: ListUploadsOptions): Promise<StoredUploadPage> {
    return { uploads: [] };
  }

  async updateHtmlProject(id: string, project: string) {
    const page = this.pages.get(id);
    if (!page) return false;
    page.metadata = { ...page.metadata, project };
    return true;
  }

  async updateFileExpiry(id: string, expiresAt: Date | null) {
    const file = this.files.get(id);
    if (!file) return false;
    file.metadata = { ...file.metadata, expiresAt: expiresAt ?? undefined };
    return true;
  }

  async deleteUpload(id: string, _options?: StorageOperationOptions) {
    this.pages.delete(id);
    this.files.delete(id);
  }

  async deleteExpiredTemporaryFiles(_expiresAtOrBefore: Date, _options?: StorageOperationOptions) {
    return 0;
  }
}

class MemoryUploadLinkRepository implements UploadLinkRepository {
  readonly token = "u".repeat(43);
  readonly id = "123e4567-e89b-42d3-a456-426614174000";
  link: UploadLink | undefined;
  files: { id: string; filename: string; bytes: number }[] = [];

  async create(expiresAt: Date): Promise<CreatedUploadLink> {
    this.link = { id: this.id, createdAt: new Date("2026-09-15T12:00:00.000Z"), expiresAt, fileCount: this.files.length };
    return { ...this.link, token: this.token };
  }
  async list() { return this.link ? [this.link] : []; }
  async find(token: string) { return token === this.token ? this.link ?? null : null; }
  async findActive(token: string, now: Date) {
    return token === this.token && this.link && !this.link.revokedAt && this.link.expiresAt > now ? this.link : null;
  }
  async listFiles(id: string) { return this.link?.id === id ? this.files : null; }
  async revoke(id: string, now: Date) {
    if (!this.link || id !== this.link.id) return false;
    this.link = { ...this.link, revokedAt: this.link.revokedAt ?? now };
    return true;
  }
}

function multipart(filename: string, content: string, type: string, project?: string) {
  const form = new FormData();
  if (project) form.set("project", project);
  form.set("file", new File([content], filename, { type }));
  return form;
}

describe("native artifact fetch handler", () => {
  it("returns an exact inventory summary when the first page requests it", async () => {
    const storage = new MemoryUploadStorage();
    storage.listUploads = vi.fn(async (_asOf, options) => ({
      uploads: [],
      ...(options.includeSummary ? {
        summary: {
          total: 142,
          permanent: 92,
          temporary: 50,
          expiringSoon: 8,
          projects: [{ project: "microservices", count: 41 }]
        }
      } : {})
    }));
    const app = createFetchApp({
      storage,
      externalUpload: true,
      uploadToken: "upload-token",
      publicBaseUrl: "https://tools.example.test"
    });

    const response = await app(new Request("https://tools.example.test/api/external-uploads?limit=100&includeSummary=true"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ summary: { total: 142, permanent: 92 } });
    expect(storage.listUploads).toHaveBeenCalledWith(expect.any(Date), expect.objectContaining({ limit: 100, includeSummary: true }));
  });

  it("creates an expiring guest upload link, accepts files, and revokes access", async () => {
    const storage = new MemoryUploadStorage();
    const uploadLinks = new MemoryUploadLinkRepository();
    const now = new Date("2026-09-15T12:00:00.000Z");
    const app = createFetchApp({
      storage,
      uploadLinks,
      externalUpload: true,
      uploadToken: "upload-token",
      publicBaseUrl: "https://tools.example.test",
      now: () => now
    });

    const createResponse = await app(new Request("https://tools.example.test/api/upload-links", {
      method: "POST",
      headers: { Origin: "https://tools.example.test", "Content-Type": "application/json" },
      body: JSON.stringify({ durationMs: 86_400_000 })
    }));
    expect(createResponse.status).toBe(201);
    expect(await createResponse.json()).toMatchObject({
      id: uploadLinks.id,
      url: `https://tools.example.test/drop/${uploadLinks.token}`,
      expiresAt: "2026-09-16T12:00:00.000Z"
    });

    const pageResponse = await app(new Request(`https://tools.example.test/drop/${uploadLinks.token}`));
    expect(pageResponse.status).toBe(200);
    const page = await pageResponse.text();
    expect(page).toContain("Choose as many files as you need");
    expect(page).toContain("/chunks");
    expect(page).toContain("20*1024*1024");
    expect(page).toContain("Retry-After");
    expect(page).toContain("for(;;)");
    expect(page).toContain("waiting for upload capacity");

    const uploadResponse = await app(new Request(`https://tools.example.test/api/drop/${uploadLinks.token}/uploads`, {
      method: "POST",
      headers: { Origin: "https://tools.example.test" },
      body: multipart("from-guest.txt", "hello", "text/plain")
    }));
    expect(uploadResponse.status).toBe(201);
    const uploaded = await uploadResponse.json() as { id: string; filename: string; bytes: number; kind: string };
    expect(uploaded).toMatchObject({ filename: "from-guest.txt", kind: "file" });
    uploadLinks.files = [{ id: uploaded.id, filename: uploaded.filename, bytes: uploaded.bytes }];
    expect(storage.files.size).toBe(1);

    const chunkInit = await app(new Request(`https://tools.example.test/api/drop/${uploadLinks.token}/uploads/chunks`, {
      method: "POST",
      headers: { Origin: "https://tools.example.test", "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "partial.bin", contentType: "application/octet-stream", totalBytes: 2_097_152, totalChunks: 2, chunkBytes: 1_048_576 })
    }));
    expect(chunkInit.status).toBe(201);
    const { sessionId: partialSessionId } = await chunkInit.json() as { sessionId: string };

    const downloadResponse = await app(new Request(`https://tools.example.test/api/upload-links/${uploadLinks.id}/download`));
    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers.get("content-type")).toBe("application/zip");
    const archiveBytes = new Uint8Array(await downloadResponse.arrayBuffer());
    expect(Buffer.from(archiveBytes).indexOf(Buffer.from([0x50, 0x4b, 0x06, 0x06]))).toBeGreaterThanOrEqual(0);
    const archive = unzipSync(archiveBytes);
    expect(strFromU8(archive["from-guest.txt"]!)).toBe("hello");

    const revokeResponse = await app(new Request(`https://tools.example.test/api/upload-links/${uploadLinks.id}`, {
      method: "DELETE",
      headers: { Origin: "https://tools.example.test" }
    }));
    expect(revokeResponse.status).toBe(204);
    expect((await app(new Request(`https://tools.example.test/api/drop/${uploadLinks.token}/uploads/chunks/${partialSessionId}`, {
      method: "DELETE", headers: { Origin: "https://tools.example.test" }
    }))).status).toBe(204);
    expect((await app(new Request(`https://tools.example.test/drop/${uploadLinks.token}`))).status).toBe(404);
    const downloadAfterRevoke = await app(new Request(`https://tools.example.test/api/upload-links/${uploadLinks.id}/download`));
    expect(downloadAfterRevoke.status).toBe(200);
    expect(strFromU8(unzipSync(new Uint8Array(await downloadAfterRevoke.arrayBuffer()))["from-guest.txt"]!)).toBe("hello");
    const unavailable = await app(new Request(`https://tools.example.test/api/drop/${uploadLinks.token}/uploads`, {
      method: "POST",
      headers: { Origin: "https://tools.example.test" },
      body: multipart("blocked.txt", "no", "text/plain")
    }));
    expect(unavailable.status).toBe(404);
    expect(await unavailable.json()).toEqual({
      error: "upload_link_unavailable",
      message: "This upload link has expired or was revoked."
    });
  });

  it("fails a bulk-download stream when a later object cannot be fetched", async () => {
    class FailingStorage extends MemoryUploadStorage {
      override async getTemporaryFile(id: string, options?: GetTemporaryFileOptions) {
        if (id === "b".repeat(32)) throw new Error("storage unavailable");
        return super.getTemporaryFile(id, options);
      }
    }
    const storage = new FailingStorage();
    const uploadLinks = new MemoryUploadLinkRepository();
    await uploadLinks.create(new Date("2026-09-16T12:00:00.000Z"));
    const metadata = { bytes: 5, originalName: "first.txt", sha256: "a".repeat(64), contentType: "text/plain", expiresAt: new Date("2026-09-16T12:00:00.000Z") };
    storage.files.set("a".repeat(32), { body: Buffer.from("first"), metadata });
    uploadLinks.files = [
      { id: "a".repeat(32), filename: "first.txt", bytes: 5 },
      { id: "b".repeat(32), filename: "second.txt", bytes: 6 }
    ];
    const app = createFetchApp({ storage, uploadLinks, uploadToken: "upload-token" });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await app(new Request(`https://tools.example.test/api/upload-links/${uploadLinks.id}/download`));
      await expect(response.arrayBuffer()).rejects.toThrow("storage unavailable");
    } finally {
      errorLog.mockRestore();
    }
  });

  it("fails a bulk-download stream when a selected object disappears", async () => {
    const storage = new MemoryUploadStorage();
    const uploadLinks = new MemoryUploadLinkRepository();
    await uploadLinks.create(new Date("2026-09-16T12:00:00.000Z"));
    uploadLinks.files = [{ id: "a".repeat(32), filename: "missing.txt", bytes: 5 }];
    const app = createFetchApp({ storage, uploadLinks, uploadToken: "upload-token" });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await app(new Request(`https://tools.example.test/api/upload-links/${uploadLinks.id}/download`));
      await expect(response.arrayBuffer()).rejects.toThrow("disappeared during archive creation");
    } finally {
      errorLog.mockRestore();
    }
  });

  it("times out stalled guest multipart bodies and releases upload capacity", async () => {
    const storage = new MemoryUploadStorage();
    const uploadLinks = new MemoryUploadLinkRepository();
    await uploadLinks.create(new Date("2026-09-16T12:00:00.000Z"));
    const boundary = "stalled-boundary";
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="slow.txt"\r\nContent-Type: text/plain\r\n\r\na`
        ));
      }
    });
    const app = createFetchApp({
      storage,
      uploadLinks,
      uploadToken: "upload-token",
      publicBaseUrl: "https://tools.example.test",
      maxConcurrentUploads: 1,
      guestUploadBodyTimeoutMs: 20
    });
    const stalled = await app(new Request(`https://tools.example.test/api/drop/${uploadLinks.token}/uploads`, {
      method: "POST",
      headers: {
        Origin: "https://tools.example.test",
        "Content-Type": `multipart/form-data; boundary=${boundary}`
      },
      body,
      duplex: "half"
    } as RequestInit));

    expect(stalled.status).toBe(408);
    expect(await stalled.json()).toMatchObject({ error: "upload_timeout" });
    const retry = await app(new Request(`https://tools.example.test/api/drop/${uploadLinks.token}/uploads`, {
      method: "POST",
      headers: { Origin: "https://tools.example.test" },
      body: multipart("retry.txt", "ok", "text/plain")
    }));
    expect(retry.status).toBe(201);
  });

  it("deduplicates case-insensitive filenames in bulk-download archives", async () => {
    const storage = new MemoryUploadStorage();
    const uploadLinks = new MemoryUploadLinkRepository();
    await uploadLinks.create(new Date("2026-09-16T12:00:00.000Z"));
    const metadata = { bytes: 5, originalName: "Report.pdf", sha256: "a".repeat(64), contentType: "application/pdf", expiresAt: new Date("2026-09-16T12:00:00.000Z") };
    storage.files.set("a".repeat(32), { body: Buffer.from("first"), metadata });
    storage.files.set("b".repeat(32), { body: Buffer.from("second"), metadata: { ...metadata, bytes: 6, originalName: "report.pdf", sha256: "b".repeat(64) } });
    uploadLinks.files = [
      { id: "a".repeat(32), filename: "Report.pdf", bytes: 5 },
      { id: "b".repeat(32), filename: "report.pdf", bytes: 6 }
    ];
    const app = createFetchApp({ storage, uploadLinks, uploadToken: "upload-token" });

    const response = await app(new Request(`https://tools.example.test/api/upload-links/${uploadLinks.id}/download`));
    const archive = unzipSync(new Uint8Array(await response.arrayBuffer()));

    expect(Object.keys(archive)).toEqual(["Report.pdf", "report (2).pdf"]);
    expect(strFromU8(archive["Report.pdf"]!)).toBe("first");
    expect(strFromU8(archive["report (2).pdf"]!)).toBe("second");
  });

  it("tracks bulk-download archive production until storage reads finish", async () => {
    let releaseRead!: () => void;
    const readReleased = new Promise<void>((resolve) => { releaseRead = resolve; });
    class BlockingStorage extends MemoryUploadStorage {
      override async getTemporaryFile(id: string, options?: GetTemporaryFileOptions) {
        await readReleased;
        return super.getTemporaryFile(id, options);
      }
    }
    const storage = new BlockingStorage();
    const uploadLinks = new MemoryUploadLinkRepository();
    const activityTracker = new ActivityTracker();
    await uploadLinks.create(new Date("2026-09-16T12:00:00.000Z"));
    storage.files.set("a".repeat(32), {
      body: Buffer.from("first"),
      metadata: { bytes: 5, originalName: "first.txt", sha256: "a".repeat(64), contentType: "text/plain", expiresAt: new Date("2026-09-16T12:00:00.000Z") }
    });
    uploadLinks.files = [{ id: "a".repeat(32), filename: "first.txt", bytes: 5 }];
    const app = createFetchApp({ storage, uploadLinks, uploadToken: "upload-token", activityTracker });

    const response = await app(new Request(`https://tools.example.test/api/upload-links/${uploadLinks.id}/download`));
    const consumed = response.arrayBuffer();
    let idle = false;
    const waiting = activityTracker.waitForIdle().then(() => { idle = true; });
    await Promise.resolve();
    expect(idle).toBe(false);

    releaseRead();
    await consumed;
    await waiting;
    expect(idle).toBe(true);
  });

  it("rejects invalid upload-link durations and cross-origin creation", async () => {
    const app = createFetchApp({
      storage: new MemoryUploadStorage(),
      uploadLinks: new MemoryUploadLinkRepository(),
      uploadToken: "upload-token",
      publicBaseUrl: "https://tools.example.test"
    });
    const invalid = await app(new Request("https://tools.example.test/api/upload-links", {
      method: "POST",
      headers: { Origin: "https://tools.example.test", "Content-Type": "application/json" },
      body: JSON.stringify({ durationMs: 1000 })
    }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ error: "invalid_upload_link_duration" });

    const crossOrigin = await app(new Request("https://tools.example.test/api/upload-links", {
      method: "POST",
      headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
      body: JSON.stringify({ durationMs: 86_400_000 })
    }));
    expect(crossOrigin.status).toBe(403);
  });

  it("streams a multipart HTML upload to storage without buffering the request", async () => {
    const storage = new MemoryUploadStorage();
    const app = createFetchApp({
      storage,
      activityTracker: new ActivityTracker(),
      uploadToken: "upload-token",
      publicBaseUrl: "https://tools.example.test"
    });

    const response = await app(
      new Request("https://tools.example.test/api/uploads", {
        method: "POST",
        headers: { Authorization: "Bearer upload-token" },
        body: multipart("index.html", "<h1>ok</h1>", "text/html", "microservices")
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload).toMatchObject({
      kind: "html",
      filename: "index.html",
      bytes: 11,
      project: "microservices"
    });
    expect(storage.pages.size).toBe(1);
    expect([...storage.pages.values()][0]?.body.toString()).toBe("<h1>ok</h1>");
    expect([...storage.pages.values()][0]?.metadata.project).toBe("microservices");
  });

  it("adds the Publisher favicon when serving HTML artifacts", async () => {
    const storage = new MemoryUploadStorage();
    const app = createFetchApp({
      storage,
      uploadToken: "upload-token",
      publisherFaviconUrl: "/assets/publisher-build-hash.png"
    });
    const createdResponse = await app(
      new Request("https://tools.example.test/api/uploads", {
        method: "POST",
        headers: { Authorization: "Bearer upload-token" },
        body: multipart(
          "index.html",
          "<!doctype html><html><head><title>Plan</title></head><body>ok</body></html>",
          "text/html"
        )
      })
    );
    const created = await createdResponse.json() as { id: string };
    const storedBody = storage.pages.get(created.id)?.body.toString();

    const response = await app(
      new Request(`https://tools.example.test/artifacts/${created.id}`)
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain(
      '<link rel="icon" href="/assets/publisher-build-hash.png" type="image/png" sizes="96x96"></head>'
    );
    expect(Number(response.headers.get("content-length"))).toBe(Buffer.byteLength(html));
    expect(storedBody).not.toContain('rel="icon"');
  });

  it("enforces the HTML limit while staging the multipart stream", async () => {
    const app = createFetchApp({
      storage: new MemoryUploadStorage(),
      uploadToken: "upload-token",
      maxUploadBytes: 64,
      maxHtmlUploadBytes: 4
    });
    const response = await app(
      new Request("https://tools.example.test/api/uploads", {
        method: "POST",
        headers: { Authorization: "Bearer upload-token" },
        body: multipart("index.html", "<h1>too large</h1>", "text/html")
      })
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: "html_payload_too_large" });
  });

  it("rejects invalid project metadata without storing the plan", async () => {
    const storage = new MemoryUploadStorage();
    const app = createFetchApp({ storage, uploadToken: "upload-token" });

    const response = await app(
      new Request("https://tools.example.test/api/uploads", {
        method: "POST",
        headers: { Authorization: "Bearer upload-token" },
        body: multipart("index.html", "<h1>ok</h1>", "text/html", "   ")
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_project" });
    expect(storage.pages.size).toBe(0);
  });

  it("lets the authenticated browser replace, reassign, and revoke an HTML artifact", async () => {
    const storage = new MemoryUploadStorage();
    const app = createFetchApp({
      storage,
      uploadToken: "upload-token",
      publicBaseUrl: "https://tools.example.test",
      externalUpload: true
    });
    const createdResponse = await app(
      new Request("https://tools.example.test/api/uploads", {
        method: "POST",
        headers: { Authorization: "Bearer upload-token" },
        body: multipart("first.html", "<h1>first</h1>", "text/html", "microservices")
      })
    );
    const created = await createdResponse.json() as { id: string; url: string };

    const replacedResponse = await app(
      new Request(`https://tools.example.test/api/external-uploads/${created.id}`, {
        method: "PUT",
        headers: { Origin: "https://tools.example.test" },
        body: multipart("replacement.html", "<h1>replacement</h1>", "text/html")
      })
    );
    expect(replacedResponse.status).toBe(200);
    expect(await replacedResponse.json()).toMatchObject({
      id: created.id,
      filename: "replacement.html",
      project: "microservices",
      url: created.url
    });
    expect(storage.pages.get(created.id)?.body.toString()).toBe("<h1>replacement</h1>");

    const projectResponse = await app(
      new Request(`https://tools.example.test/api/external-uploads/${created.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://tools.example.test"
        },
        body: JSON.stringify({ project: "documentation" })
      })
    );
    expect(projectResponse.status).toBe(200);
    expect(await projectResponse.json()).toEqual({ id: created.id, project: "documentation" });
    expect(storage.pages.get(created.id)?.metadata.project).toBe("documentation");

    const revokedResponse = await app(
      new Request(`https://tools.example.test/api/external-uploads/${created.id}`, {
        method: "DELETE",
        headers: { Origin: "https://tools.example.test" }
      })
    );
    expect(revokedResponse.status).toBe(204);
    expect((await app(new Request(created.url))).status).toBe(404);
  });

  it("lets the authenticated browser change a file expiry or make it permanent", async () => {
    const storage = new MemoryUploadStorage();
    const now = new Date("2026-08-14T12:00:00.000Z");
    const app = createFetchApp({
      storage,
      uploadToken: "upload-token",
      publicBaseUrl: "https://tools.example.test",
      externalUpload: true,
      now: () => now
    });
    const createdResponse = await app(
      new Request("https://tools.example.test/api/external-uploads", {
        method: "POST",
        headers: { Origin: "https://tools.example.test" },
        body: multipart("report.pdf", "report", "application/pdf")
      })
    );
    const created = await createdResponse.json() as { id: string; url: string };
    const expiresAt = "2026-08-30T12:00:00.000Z";

    const expiryResponse = await app(
      new Request(`https://tools.example.test/api/external-uploads/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Origin: "https://tools.example.test" },
        body: JSON.stringify({ expiresAt })
      })
    );
    expect(expiryResponse.status).toBe(200);
    expect(await expiryResponse.json()).toEqual({ id: created.id, expiresAt });
    expect(storage.files.get(created.id)?.metadata.expiresAt).toEqual(new Date(expiresAt));

    const permanentResponse = await app(
      new Request(`https://tools.example.test/api/external-uploads/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Origin: "https://tools.example.test" },
        body: JSON.stringify({ expiresAt: null })
      })
    );
    expect(permanentResponse.status).toBe(200);
    expect(await permanentResponse.json()).toEqual({ id: created.id, expiresAt: null });
    expect(storage.files.get(created.id)?.metadata.expiresAt).toBeUndefined();
    expect((await app(new Request(created.url))).status).toBe(200);
  });

  it("rejects file expiry timestamps in the past", async () => {
    const storage = new MemoryUploadStorage();
    const app = createFetchApp({
      storage,
      uploadToken: "upload-token",
      publicBaseUrl: "https://tools.example.test",
      externalUpload: true,
      now: () => new Date("2026-08-14T12:00:00.000Z")
    });

    const response = await app(
      new Request(`https://tools.example.test/api/external-uploads/${"a".repeat(32)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Origin: "https://tools.example.test" },
        body: JSON.stringify({ expiresAt: "2026-08-14T11:59:59.000Z" })
      })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_expiry" });
  });

  it("rejects cross-origin browser lifecycle mutations", async () => {
    const storage = new MemoryUploadStorage();
    const app = createFetchApp({
      storage,
      uploadToken: "upload-token",
      externalUpload: true
    });

    const response = await app(
      new Request(`https://tools.example.test/api/external-uploads/${"a".repeat(32)}`, {
        method: "DELETE",
        headers: { Origin: "https://attacker.example" }
      })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "invalid_origin" });
  });

  it("accepts the public origin when a TLS proxy forwards an HTTP request URL", async () => {
    const storage = new MemoryUploadStorage();
    const app = createFetchApp({
      storage,
      uploadToken: "upload-token",
      externalUpload: true,
      publicBaseUrl: "https://tools.example.test"
    });
    const form = new FormData();
    form.append("file", new File(["private"], "private.txt", { type: "text/plain" }));

    const response = await app(
      new Request("http://tools.example.test/api/external-uploads", {
        method: "POST",
        headers: { Origin: "https://tools.example.test" },
        body: form
      })
    );

    expect(response.status).toBe(201);
  });
});

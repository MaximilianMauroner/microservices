import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { ActivityTracker } from "../src/activity-tracker.js";
import { createFetchApp } from "../src/fetch-app.js";
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

function multipart(filename: string, content: string, type: string, project?: string) {
  const form = new FormData();
  if (project) form.set("project", project);
  form.set("file", new File([content], filename, { type }));
  return form;
}

describe("native artifact fetch handler", () => {
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
        body: JSON.stringify({ project: "field-guide" })
      })
    );
    expect(projectResponse.status).toBe(200);
    expect(await projectResponse.json()).toEqual({ id: created.id, project: "field-guide" });
    expect(storage.pages.get(created.id)?.metadata.project).toBe("field-guide");

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

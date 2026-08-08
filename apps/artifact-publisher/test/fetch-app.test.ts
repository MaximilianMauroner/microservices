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
  readonly files = new Map<string, { body: Buffer; metadata: PutTemporaryFileMetadata }>();

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
      expiresAt: file.metadata.expiresAt,
      sha256: file.metadata.sha256,
      lastModified: new Date("2026-01-01T00:00:00.000Z")
    };
  }

  async listUploads(_asOf: Date, _options: ListUploadsOptions): Promise<StoredUploadPage> {
    return { uploads: [] };
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
});

import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, DEFAULT_MAX_UPLOAD_BYTES, MAX_SINGLE_PUT_UPLOAD_BYTES } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type {
  PutHtmlMetadata,
  PutTemporaryFileMetadata,
  StoredHtml,
  StoredTemporaryFile,
  UploadStorage
} from "../src/storage.js";

class MemoryUploadStorage implements UploadStorage {
  readonly pages = new Map<string, { body: Buffer; metadata: PutHtmlMetadata }>();
  readonly files = new Map<
    string,
    { body: Buffer; lastModified: Date; metadata: PutTemporaryFileMetadata }
  >();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async putHtml(id: string, filePath: string, metadata: PutHtmlMetadata) {
    const body = await readFile(filePath);
    this.pages.set(id, { body, metadata });
  }

  async getHtml(id: string): Promise<StoredHtml | null> {
    const page = this.pages.get(id);
    return page ? { body: page.body } : null;
  }

  async putTemporaryFile(id: string, filePath: string, metadata: PutTemporaryFileMetadata) {
    const body = await readFile(filePath);
    this.files.set(id, { body, lastModified: this.now(), metadata });
  }

  async getTemporaryFile(id: string): Promise<StoredTemporaryFile | null> {
    const file = this.files.get(id);
    return file
      ? {
          body: Readable.from(file.body),
          contentType: file.metadata.contentType,
          expiresAt: file.metadata.expiresAt,
          originalName: file.metadata.originalName
        }
      : null;
  }

  async deleteExpiredTemporaryFiles(cutoff: Date) {
    let deleted = 0;

    for (const [id, file] of this.files) {
      if (file.lastModified > cutoff) {
        continue;
      }

      this.files.delete(id);
      deleted += 1;
    }

    return deleted;
  }
}

function setup(
  options: { maxUploadBytes?: number; now?: () => Date; temporaryFileRetentionMs?: number } = {}
) {
  const storage = new MemoryUploadStorage(options.now);
  const app = createApp({
    storage,
    uploadToken: "test-upload-token",
    publicBaseUrl: "https://html.example",
    maxUploadBytes: options.maxUploadBytes,
    now: options.now,
    temporaryFileRetentionMs: options.temporaryFileRetentionMs
  });

  return { app, storage };
}

function binaryParser(res: request.Response, callback: (error: Error | null, body: unknown) => void) {
  const chunks: Buffer[] = [];

  res.on("data", (chunk: Buffer | string) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  res.on("end", () => {
    callback(null, Buffer.concat(chunks));
  });
  res.on("error", (error: Error) => {
    callback(error, Buffer.alloc(0));
  });
}

describe("html publisher", () => {
  it("rejects a configured upload limit above the 5 GB single-put cap", () => {
    expect(() =>
      loadConfig({
        S3_ACCESS_KEY_ID: "test-s3-access-key-id",
        S3_BUCKET: "bucket",
        S3_ENDPOINT: "https://storage.example",
        S3_REGION: "region",
        S3_SECRET_ACCESS_KEY: "test-s3-secret-value",
        UPLOAD_TOKEN: "test-upload-token",
        MAX_UPLOAD_BYTES: "5000000001"
      })
    ).toThrow("MAX_UPLOAD_BYTES must be less than or equal to 5000000000");
  });

  it("rejects uploads without an upload token", async () => {
    const { app } = setup();

    await request(app)
      .post("/api/uploads")
      .attach("file", Buffer.from("<html></html>"), {
        filename: "page.html",
        contentType: "text/html"
      })
      .expect(401);
  });

  it("rejects uploads with the wrong upload token", async () => {
    const { app } = setup();

    await request(app)
      .post("/api/uploads")
      .set("Authorization", "Bearer wrong-upload-token")
      .attach("file", Buffer.from("<html></html>"), {
        filename: "page.html",
        contentType: "text/html"
      })
      .expect(401);
  });

  it("uses a 5 GB default upload limit", () => {
    expect(DEFAULT_MAX_UPLOAD_BYTES).toBe(5_000_000_000);
    expect(DEFAULT_MAX_UPLOAD_BYTES).toBe(MAX_SINGLE_PUT_UPLOAD_BYTES);
  });

  it("serves the site favicon", async () => {
    const { app } = setup();

    for (const path of ["/favicon.svg", "/favicon.ico"]) {
      const response = await request(app).get(path).buffer(true).parse(binaryParser).expect(200);

      expect(response.headers["content-type"]).toContain("image/svg+xml");
      expect(response.headers["cache-control"]).toBe("public, max-age=86400");
      const body: unknown = response.body;
      expect(Buffer.isBuffer(body)).toBe(true);
      if (!Buffer.isBuffer(body)) {
        throw new Error("Expected favicon response body to be a Buffer");
      }
      expect(body.toString("utf8")).toContain("<svg");
    }
  });

  it("stores an arbitrary file upload and returns an expiring download url", async () => {
    const now = new Date("2026-07-07T12:00:00.000Z");
    const { app, storage } = setup({
      now: () => now,
      temporaryFileRetentionMs: 3 * 24 * 60 * 60 * 1000
    });
    const text = Buffer.from("hello");

    const uploadResponse = await request(app)
      .post("/api/uploads")
      .set("Authorization", "Bearer test-upload-token")
      .attach("file", text, {
        filename: "note.txt",
        contentType: "text/plain"
      })
      .expect(201);

    expect(uploadResponse.body).toMatchObject({
      url: expect.stringMatching(/^https:\/\/html\.example\/f\/[A-Za-z0-9_-]{32}\/note\.txt$/),
      bytes: text.length,
      expiresAt: "2026-07-10T12:00:00.000Z",
      sha256: crypto.createHash("sha256").update(text).digest("hex")
    });
    expect(storage.files.get(uploadResponse.body.id)?.body.equals(text)).toBe(true);
    expect(storage.files.get(uploadResponse.body.id)?.metadata).toMatchObject({
      bytes: text.length,
      contentType: "text/plain",
      originalName: "note.txt"
    });

    const downloadResponse = await request(app)
      .get(new URL(uploadResponse.body.url).pathname)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);

    const downloadBody: unknown = downloadResponse.body;
    expect(Buffer.isBuffer(downloadBody)).toBe(true);
    if (!Buffer.isBuffer(downloadBody)) {
      throw new Error("Expected temporary file response body to be a Buffer");
    }
    expect(downloadBody.equals(text)).toBe(true);
    expect(downloadResponse.headers["content-type"]).toContain("text/plain");
    expect(downloadResponse.headers["content-disposition"]).toBe('attachment; filename="note.txt"');
  });

  it("falls back to application/octet-stream for unknown file types", async () => {
    const { app } = setup();

    const response = await request(app)
      .post("/api/uploads")
      .set("Authorization", "Bearer test-upload-token")
      .attach("file", Buffer.from("binary"), {
        filename: "archive.blob",
        contentType: ""
      })
      .expect(201);

    const downloadResponse = await request(app)
      .get(new URL(response.body.url).pathname)
      .expect(200);

    expect(downloadResponse.headers["content-type"]).toContain("application/octet-stream");
  });

  it("rejects oversized uploads", async () => {
    const { app } = setup({ maxUploadBytes: 8 });

    await request(app)
      .post("/api/uploads")
      .set("Authorization", "Bearer test-upload-token")
      .attach("file", Buffer.from("<html></html>"), {
        filename: "page.html",
        contentType: "text/html"
      })
      .expect(413);
  });

  it("stores a valid html upload and returns a public url", async () => {
    const { app, storage } = setup();
    const html = Buffer.from("<!doctype html><html><body>Hello</body></html>");

    const response = await request(app)
      .post("/api/uploads")
      .set("Authorization", "Bearer test-upload-token")
      .attach("file", html, {
        filename: "page.html",
        contentType: "text/html"
      })
      .expect(201);

    expect(response.body).toMatchObject({
      url: expect.stringMatching(/^https:\/\/html\.example\/p\/[A-Za-z0-9_-]{32}$/),
      bytes: html.length,
      sha256: crypto.createHash("sha256").update(html).digest("hex")
    });
    expect(response.body.id).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(storage.pages.get(response.body.id)?.body.equals(html)).toBe(true);
    expect(storage.pages.get(response.body.id)?.metadata.bytes).toBe(html.length);
  });

  it("stores an apk upload with its Android package content type", async () => {
    const now = new Date("2026-07-07T12:00:00.000Z");
    const { app, storage } = setup({
      now: () => now,
      temporaryFileRetentionMs: 3 * 24 * 60 * 60 * 1000
    });
    const apk = Buffer.from("apk bytes");

    const uploadResponse = await request(app)
      .post("/api/uploads")
      .set("Authorization", "Bearer test-upload-token")
      .attach("file", apk, {
        filename: "release.apk",
        contentType: "application/vnd.android.package-archive"
      })
      .expect(201);

    expect(uploadResponse.body).toMatchObject({
      url: expect.stringMatching(/^https:\/\/html\.example\/f\/[A-Za-z0-9_-]{32}\/release\.apk$/),
      bytes: apk.length,
      expiresAt: "2026-07-10T12:00:00.000Z",
      sha256: crypto.createHash("sha256").update(apk).digest("hex")
    });
    expect(storage.files.get(uploadResponse.body.id)?.body.equals(apk)).toBe(true);
    expect(storage.files.get(uploadResponse.body.id)?.metadata).toMatchObject({
      bytes: apk.length,
      contentType: "application/vnd.android.package-archive",
      originalName: "release.apk"
    });

    const downloadResponse = await request(app)
      .get(new URL(uploadResponse.body.url).pathname)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);

    const downloadBody: unknown = downloadResponse.body;
    expect(Buffer.isBuffer(downloadBody)).toBe(true);
    if (!Buffer.isBuffer(downloadBody)) {
      throw new Error("Expected temporary file response body to be a Buffer");
    }
    expect(downloadBody.equals(apk)).toBe(true);
    expect(downloadResponse.headers["content-type"]).toContain(
      "application/vnd.android.package-archive"
    );
    expect(downloadResponse.headers["content-disposition"]).toBe(
      'attachment; filename="release.apk"'
    );
    expect(downloadResponse.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("serves public html with script-friendly sandbox headers", async () => {
    const { app } = setup();
    const html =
      "<!doctype html><html><body><script>document.body.dataset.ready = 'yes';</script>Hello</body></html>";
    const uploadResponse = await request(app)
      .post("/api/uploads")
      .set("Authorization", "Bearer test-upload-token")
      .attach("file", Buffer.from(html), {
        filename: "page.html",
        contentType: "text/html"
      })
      .expect(201);

    const response = await request(app).get(`/p/${uploadResponse.body.id}`).expect(200);

    expect(response.text).toBe(html);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["content-security-policy"]).toBe(
      "sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads"
    );
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["x-robots-tag"]).toBe("noindex, nofollow");
  });

  it("returns 404 for invalid or missing public ids", async () => {
    const { app } = setup();

    await request(app).get("/p/not-valid").expect(404);
    await request(app).get("/p/0123456789abcdefghijklmnopqrstuv").expect(404);
    await request(app).get("/f/not-valid/release.apk").expect(404);
  });

  it("returns 404 for expired temporary files", async () => {
    let now = new Date("2026-07-07T12:00:00.000Z");
    const { app } = setup({
      now: () => now,
      temporaryFileRetentionMs: 1000
    });

    const uploadResponse = await request(app)
      .post("/api/uploads")
      .set("Authorization", "Bearer test-upload-token")
      .attach("file", Buffer.from("apk bytes"), {
        filename: "release.apk",
        contentType: "application/octet-stream"
      })
      .expect(201);

    now = new Date("2026-07-07T12:00:01.001Z");
    await request(app).get(new URL(uploadResponse.body.url).pathname).expect(404);
  });

  it("deletes expired temporary files from storage", async () => {
    let now = new Date("2026-07-07T12:00:00.000Z");
    const { app, storage } = setup({
      now: () => now,
      temporaryFileRetentionMs: 3 * 24 * 60 * 60 * 1000
    });

    const uploadResponse = await request(app)
      .post("/api/uploads")
      .set("Authorization", "Bearer test-upload-token")
      .attach("file", Buffer.from("apk bytes"), {
        filename: "release.apk",
        contentType: "application/octet-stream"
      })
      .expect(201);

    expect(storage.files.has(uploadResponse.body.id)).toBe(true);
    expect(await storage.deleteExpiredTemporaryFiles(new Date("2026-07-07T11:59:59.999Z"))).toBe(
      0
    );

    now = new Date("2026-07-10T12:00:00.001Z");
    expect(await storage.deleteExpiredTemporaryFiles(new Date("2026-07-07T12:00:00.001Z"))).toBe(
      1
    );
    expect(storage.files.has(uploadResponse.body.id)).toBe(false);
  });
});

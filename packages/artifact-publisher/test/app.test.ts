import crypto from "node:crypto";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import type { RequestHandler } from "express";
import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { ActivityTracker } from "../src/activity-tracker.js";
import {
  createApp,
  DEFAULT_MAX_CONCURRENT_UPLOADS,
  DEFAULT_MAX_HTML_UPLOAD_BYTES,
  DEFAULT_MAX_UPLOAD_BYTES,
  MAX_SINGLE_PUT_UPLOAD_BYTES
} from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type {
  GetTemporaryFileOptions,
  GetStoredObjectOptions,
  ListUploadsOptions,
  PutHtmlMetadata,
  PutHtmlOptions,
  PutTemporaryFileMetadata,
  StorageOperationOptions,
  StoredHtml,
  StoredTemporaryFile,
  StoredUploadSummary,
  UploadStorage
} from "../src/storage.js";
import { HtmlUpdateConflictError, RangeNotSatisfiableError } from "../src/storage.js";

class MemoryUploadStorage implements UploadStorage {
  readonly pages = new Map<
    string,
    { body: Buffer; etag: string; lastModified: Date; metadata: PutHtmlMetadata }
  >();
  readonly files = new Map<
    string,
    { body: Buffer; lastModified: Date; metadata: PutTemporaryFileMetadata }
  >();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async putHtml(
    id: string,
    filePath: string,
    metadata: PutHtmlMetadata,
    options?: PutHtmlOptions
  ) {
    const existing = this.pages.get(id);
    if (options?.ifMatch && existing?.etag !== options.ifMatch) {
      throw new HtmlUpdateConflictError();
    }
    const body = await readFile(filePath);
    this.pages.set(id, {
      body,
      etag: `"storage-${metadata.sha256}"`,
      lastModified: this.now(),
      metadata
    });
  }

  async getHtml(id: string, options?: GetStoredObjectOptions): Promise<StoredHtml | null> {
    const page = this.pages.get(id);
    return page
      ? {
          body: Readable.from(options?.headOnly ? Buffer.alloc(0) : page.body),
          bytes: page.body.length,
          etag: page.etag,
          sha256: page.metadata.sha256,
          lastModified: page.lastModified,
          ...(page.metadata.project ? { project: page.metadata.project } : {})
        }
      : null;
  }

  async putTemporaryFile(id: string, filePath: string, metadata: PutTemporaryFileMetadata) {
    const body = await readFile(filePath);
    this.files.set(id, { body, lastModified: this.now(), metadata });
  }

  async getTemporaryFile(
    id: string,
    options?: GetTemporaryFileOptions
  ): Promise<StoredTemporaryFile | null> {
    const file = this.files.get(id);
    if (!file) {
      return null;
    }

    let rangedBody: { body: Buffer; contentRange?: string };
    try {
      rangedBody = options?.headOnly
        ? { body: Buffer.alloc(0) }
        : applyRange(file.body, options?.range);
    } catch (error) {
      if (error instanceof RangeNotSatisfiableError) {
        throw new RangeNotSatisfiableError(error.totalBytes, file.metadata.expiresAt);
      }
      throw error;
    }
    return {
      body: Readable.from(rangedBody.body),
      bytes: options?.headOnly ? file.body.length : rangedBody.body.length,
      contentRange: rangedBody.contentRange,
      contentType: file.metadata.contentType,
      expiresAt: file.metadata.expiresAt,
      originalName: file.metadata.originalName,
      sha256: file.metadata.sha256,
      lastModified: file.lastModified
    };
  }

  async listUploads(asOf: Date, options: ListUploadsOptions) {
    const pages = Array.from(this.pages, ([id, page]) => ({
      key: `pages/${id}.html`,
      summary: {
        id,
        kind: "html" as const,
        originalName: page.metadata.originalName,
        bytes: page.metadata.bytes,
        contentType: "text/html; charset=utf-8",
        updatedAt: page.lastModified,
        ...(page.metadata.project ? { project: page.metadata.project } : {})
      }
    }));
    const files = Array.from(this.files, ([id, file]) => ({
      key: `files/${id}`,
      summary: {
        id,
        kind: "file" as const,
        originalName: file.metadata.originalName,
        bytes: file.metadata.bytes,
        contentType: file.metadata.contentType,
        updatedAt: file.lastModified,
        expiresAt: file.metadata.expiresAt
      }
    })).filter(({ summary }) => summary.expiresAt > asOf);
    const entries: Array<{ key: string; summary: StoredUploadSummary }> = [
      ...pages,
      ...files
    ];
    const cursor = options.cursor;
    const sort = options.sort ?? "newest";
    const query = options.q?.trim().normalize("NFKC").toLowerCase() ?? "";
    const candidates = entries
      .filter(({ summary }) => !options.kind || summary.kind === options.kind)
      .filter(({ summary }) => !query || summary.originalName.normalize("NFKC").toLowerCase().includes(query))
      .filter(({ summary }) => matchesMemoryExpiry(summary, options.expiry ?? "all", asOf))
      .sort(memoryUploadComparator(sort))
      .filter((entry) => !cursor || memoryUploadComparator(sort)(entry, {
        key: cursor.key,
        summary: {
          id: "cursor",
          kind: cursor.key.startsWith("pages/") ? "html" : "file",
          originalName: cursor.originalName ?? cursor.key,
          bytes: 0,
          contentType: "application/octet-stream",
          updatedAt: cursor.updatedAt,
          ...(cursor.expiresAt ? { expiresAt: cursor.expiresAt } : {})
        }
      }) > 0);
    const page = candidates.slice(0, options.limit);
    const last = page.at(-1);

    return {
      uploads: page.map(({ summary }) => summary),
      ...(last && page.length < candidates.length
        ? {
            nextCursor: {
              version: 1 as const,
              criteria: options.criteria ?? "legacy:newest",
              updatedAt: last.summary.updatedAt,
              key: last.key,
              originalName: last.summary.originalName,
              ...(last.summary.expiresAt ? { expiresAt: last.summary.expiresAt } : {})
            }
          }
        : {})
    };
  }

  async deleteUpload(id: string) {
    this.pages.delete(id);
    this.files.delete(id);
  }

  async updateHtmlProject(id: string, project: string) {
    const page = this.pages.get(id);
    if (!page) return false;
    page.metadata = { ...page.metadata, project };
    page.lastModified = this.now();
    return true;
  }

  async deleteExpiredTemporaryFiles(expiresAtOrBefore: Date) {
    let deleted = 0;

    for (const [id, file] of this.files) {
      if (file.metadata.expiresAt > expiresAtOrBefore) {
        continue;
      }

      this.files.delete(id);
      deleted += 1;
    }

    return deleted;
  }
}

type MemoryUploadEntry = { key: string; summary: StoredUploadSummary };

function memoryUploadComparator(sort: NonNullable<ListUploadsOptions["sort"]>) {
  return (left: MemoryUploadEntry, right: MemoryUploadEntry): number => {
    if (sort === "oldest") {
      return left.summary.updatedAt.getTime() - right.summary.updatedAt.getTime() || left.key.localeCompare(right.key);
    }
    if (sort === "filename") {
      return left.summary.originalName.localeCompare(right.summary.originalName, undefined, { sensitivity: "base" }) || left.key.localeCompare(right.key);
    }
    if (sort === "expiry") {
      return (left.summary.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY) - (right.summary.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY) || left.key.localeCompare(right.key);
    }
    return right.summary.updatedAt.getTime() - left.summary.updatedAt.getTime() || left.key.localeCompare(right.key);
  };
}

function matchesMemoryExpiry(
  upload: StoredUploadSummary,
  expiry: NonNullable<ListUploadsOptions["expiry"]>,
  asOf: Date
): boolean {
  if (expiry === "all") return true;
  if (expiry === "persistent") return upload.kind === "html";
  if (!upload.expiresAt) return false;
  const windowMs = expiry === "24h" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  return upload.expiresAt.getTime() <= asOf.getTime() + windowMs;
}

class BlockingUploadStorage extends MemoryUploadStorage {
  private readonly started: Promise<void>;
  private readonly unblock: Promise<void>;
  private markStarted!: () => void;
  private allowUpload!: () => void;

  constructor() {
    super();
    this.started = new Promise((resolve) => {
      this.markStarted = resolve;
    });
    this.unblock = new Promise((resolve) => {
      this.allowUpload = resolve;
    });
  }

  override async putTemporaryFile(
    id: string,
    filePath: string,
    metadata: PutTemporaryFileMetadata
  ) {
    this.markStarted();
    await this.unblock;
    await super.putTemporaryFile(id, filePath, metadata);
  }

  waitUntilStarted() {
    return this.started;
  }

  releaseUpload() {
    this.allowUpload();
  }
}

class CommitThenFailStorage extends MemoryUploadStorage {
  readonly deletedIds: string[] = [];

  override async putHtml(id: string, filePath: string, metadata: PutHtmlMetadata) {
    await super.putHtml(id, filePath, metadata);
    throw new Error("Upload outcome was uncertain");
  }

  override async deleteUpload(id: string) {
    this.deletedIds.push(id);
    await super.deleteUpload(id);
  }
}

class UpdateFailureStorage extends MemoryUploadStorage {
  readonly deletedIds: string[] = [];
  failure: "before-commit" | "after-commit" | undefined;

  override async putHtml(id: string, filePath: string, metadata: PutHtmlMetadata) {
    if (this.failure === "before-commit") {
      throw new Error("Update failed before commit");
    }
    await super.putHtml(id, filePath, metadata);
    if (this.failure === "after-commit") {
      throw new Error("Update outcome was uncertain");
    }
  }

  override async deleteUpload(id: string) {
    this.deletedIds.push(id);
    await super.deleteUpload(id);
  }
}

class DeleteBeforeConditionalHtmlWriteStorage extends MemoryUploadStorage {
  override async putHtml(
    id: string,
    filePath: string,
    metadata: PutHtmlMetadata,
    options?: PutHtmlOptions
  ) {
    if (options?.ifMatch) {
      await this.deleteUpload(id);
    }
    await super.putHtml(id, filePath, metadata, options);
  }
}

class BlockingHtmlUpdateStorage extends MemoryUploadStorage {
  private readonly started: Promise<void>;
  private readonly unblock: Promise<void>;
  private markStarted!: () => void;
  private allowUpdate!: () => void;
  blockUpdates = false;

  constructor() {
    super();
    this.started = new Promise((resolve) => {
      this.markStarted = resolve;
    });
    this.unblock = new Promise((resolve) => {
      this.allowUpdate = resolve;
    });
  }

  override async putHtml(id: string, filePath: string, metadata: PutHtmlMetadata) {
    if (this.blockUpdates) {
      this.markStarted();
      await this.unblock;
    }
    await super.putHtml(id, filePath, metadata);
  }

  waitUntilStarted() {
    return this.started;
  }

  releaseUpdate() {
    this.allowUpdate();
  }
}

class AbortAwareUpdateStorage extends MemoryUploadStorage {
  readonly deletedIds: string[] = [];
  private readonly started: Promise<void>;
  private readonly aborted: Promise<void>;
  private markStarted!: () => void;
  private markAborted!: () => void;
  observeUpdates = false;

  constructor() {
    super();
    this.started = new Promise((resolve) => {
      this.markStarted = resolve;
    });
    this.aborted = new Promise((resolve) => {
      this.markAborted = resolve;
    });
  }

  override async putHtml(
    id: string,
    filePath: string,
    metadata: PutHtmlMetadata,
    options?: StorageOperationOptions
  ) {
    if (!this.observeUpdates) {
      await super.putHtml(id, filePath, metadata);
      return;
    }
    const signal = options?.signal;
    if (!signal) {
      throw new Error("Expected an update abort signal");
    }
    this.markStarted();
    if (!signal.aborted) {
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    }
    this.markAborted();
    throw new Error("Update aborted");
  }

  override async deleteUpload(id: string) {
    this.deletedIds.push(id);
    await super.deleteUpload(id);
  }

  waitUntilStarted() {
    return this.started;
  }

  waitUntilAborted() {
    return this.aborted;
  }
}

class BlockingCleanupAfterCommitStorage extends MemoryUploadStorage {
  private readonly cleanupStarted: Promise<void>;
  private readonly cleanupAllowed: Promise<void>;
  private markCleanupStarted!: () => void;
  private allowCleanup!: () => void;

  constructor() {
    super();
    this.cleanupStarted = new Promise((resolve) => {
      this.markCleanupStarted = resolve;
    });
    this.cleanupAllowed = new Promise((resolve) => {
      this.allowCleanup = resolve;
    });
  }

  override async putHtml(id: string, filePath: string, metadata: PutHtmlMetadata) {
    await super.putHtml(id, filePath, metadata);
    throw new Error("Upload outcome was uncertain");
  }

  override async deleteUpload(id: string) {
    this.markCleanupStarted();
    await this.cleanupAllowed;
    await super.deleteUpload(id);
  }

  waitUntilCleanupStarted() {
    return this.cleanupStarted;
  }

  releaseCleanup() {
    this.allowCleanup();
  }
}

class AbortAwareReadStorage extends MemoryUploadStorage {
  private readonly started: Promise<void>;
  private readonly aborted: Promise<void>;
  private markStarted!: () => void;
  private markAborted!: () => void;

  constructor(private readonly target: "file" | "html") {
    super();
    this.started = new Promise((resolve) => {
      this.markStarted = resolve;
    });
    this.aborted = new Promise((resolve) => {
      this.markAborted = resolve;
    });
  }

  override async getHtml(
    id: string,
    options?: GetStoredObjectOptions
  ): Promise<StoredHtml | null> {
    if (this.target === "html") {
      await this.waitForAbort(options?.signal);
      return null;
    }
    return super.getHtml(id, options);
  }

  override async getTemporaryFile(
    id: string,
    options?: GetTemporaryFileOptions
  ): Promise<StoredTemporaryFile | null> {
    if (this.target === "file") {
      await this.waitForAbort(options?.signal);
      return null;
    }
    return super.getTemporaryFile(id, options);
  }

  waitUntilStarted() {
    return this.started;
  }

  waitUntilAborted() {
    return this.aborted;
  }

  private async waitForAbort(signal: AbortSignal | undefined) {
    if (!signal) {
      throw new Error("Expected a storage abort signal");
    }

    this.markStarted();
    if (!signal.aborted) {
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    }
    this.markAborted();
  }
}

function applyRange(body: Buffer, range: string | undefined) {
  if (!range) {
    return { body };
  }

  const match = range.match(/^bytes=(?:(\d+)-(\d*)|-(\d+))$/i);
  if (!match || body.length === 0) {
    throw new RangeNotSatisfiableError(body.length);
  }

  let start: number;
  let end: number;
  if (match[3]) {
    const suffixLength = Number(match[3]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      throw new RangeNotSatisfiableError(body.length);
    }
    start = Math.max(body.length - suffixLength, 0);
    end = body.length - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : body.length - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= body.length) {
      throw new RangeNotSatisfiableError(body.length);
    }
    end = Math.min(end, body.length - 1);
  }

  if (end < start) {
    throw new RangeNotSatisfiableError(body.length);
  }

  return {
    body: body.subarray(start, end + 1),
    contentRange: `bytes ${start}-${end}/${body.length}`
  };
}

function setup(
  options: {
    maxUploadBytes?: number;
    maxHtmlUploadBytes?: number;
    maxConcurrentUploads?: number;
    externalUploadAuth?: RequestHandler;
    now?: () => Date;
    temporaryFileRetentionMs?: number;
  } = {}
) {
  const storage = new MemoryUploadStorage(options.now);
  const app = createApp({
    storage,
    uploadToken: "test-upload-token",
    externalUpload: options.externalUploadAuth
      ? {
          auth: options.externalUploadAuth
        }
      : undefined,
    publicBaseUrl: "https://html.example",
    maxUploadBytes: options.maxUploadBytes,
    maxHtmlUploadBytes: options.maxHtmlUploadBytes,
    maxConcurrentUploads: options.maxConcurrentUploads,
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

function validConfigEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    S3_ACCESS_KEY_ID: "test-s3-access-key-id",
    S3_BUCKET: "bucket",
    S3_ENDPOINT: "https://storage.example",
    S3_REGION: "region",
    S3_SECRET_ACCESS_KEY: "test-s3-secret-value",
    UPLOAD_TOKEN: "test-upload-token",
    ...overrides
  };
}

async function expectCancelledStorageRead(target: "file" | "html") {
  const storage = new AbortAwareReadStorage(target);
  const app = createApp({
    storage,
    uploadToken: "test-upload-token",
    publicBaseUrl: "https://html.example"
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const id = "a".repeat(32);
  const path = target === "html" ? `/p/${id}` : `/f/${id}/note.txt`;
  const clientRequest = http.get({ host: "127.0.0.1", path, port: address.port });
  clientRequest.on("error", () => undefined);

  try {
    await storage.waitUntilStarted();
    clientRequest.destroy();
    await storage.waitUntilAborted();
  } finally {
    clientRequest.destroy();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe("html publisher", () => {
  it("rejects a configured upload limit above the 5 GB single-put cap", () => {
    expect(() =>
      loadConfig(
        validConfigEnv({
          MAX_UPLOAD_BYTES: "5000000001"
        })
      )
    ).toThrow("MAX_UPLOAD_BYTES must be less than or equal to 5000000000");
  });

  it("strictly validates runtime limits, booleans, and public URLs", () => {
    expect(() => loadConfig(validConfigEnv({ PORT: "3000junk" }))).toThrow(
      "PORT must be a positive integer"
    );
    expect(() =>
      loadConfig(validConfigEnv({ TEMPORARY_FILE_CLEANUP_INTERVAL_MS: "2147483648" }))
    ).toThrow("TEMPORARY_FILE_CLEANUP_INTERVAL_MS must be less than or equal to 2147483647");
    expect(() => loadConfig(validConfigEnv({ S3_FORCE_PATH_STYLE: "yes" }))).toThrow(
      "S3_FORCE_PATH_STYLE must be either true or false"
    );
    expect(() =>
      loadConfig(validConfigEnv({ PUBLIC_BASE_URL: "https://html.example/path" }))
    ).toThrow("PUBLIC_BASE_URL must be a valid HTTP(S) origin");
    expect(() =>
      loadConfig(
        validConfigEnv({
          MAX_UPLOAD_BYTES: "100",
          MAX_HTML_UPLOAD_BYTES: "101"
        })
      )
    ).toThrow("MAX_HTML_UPLOAD_BYTES must be less than or equal to MAX_UPLOAD_BYTES");
  });

  it("requires and normalizes the public origin in production", () => {
    expect(() => loadConfig(validConfigEnv({ NODE_ENV: "production" }))).toThrow(
      "PUBLIC_BASE_URL is required when NODE_ENV=production"
    );

    const config = loadConfig(
      validConfigEnv({ NODE_ENV: "production", PUBLIC_BASE_URL: "https://html.example/" })
    );
    expect(config.publicBaseUrl).toBe("https://html.example");
  });

  it("rejects uploads without an upload token", async () => {
    const { app } = setup();

    const response = await request(app)
      .post("/api/uploads")
      .attach("file", Buffer.from("<html></html>"), {
        filename: "page.html",
        contentType: "text/html"
      })
      .expect(401);

    expect(response.headers["www-authenticate"]).toBe('Bearer realm="uploads"');
    expect(response.body).toMatchObject({ error: "unauthorized" });
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

  it("returns stable client errors for invalid upload requests", async () => {
    const { app } = setup();

    const unsupported = await request(app)
      .post("/api/uploads")
      .set("Authorization", "Bearer test-upload-token")
      .send("not multipart")
      .expect(415);
    expect(unsupported.body).toMatchObject({ error: "unsupported_media_type" });

    const wrongField = await request(app)
      .post("/api/uploads")
      .set("Authorization", "Bearer test-upload-token")
      .attach("attachment", Buffer.from("hello"), { filename: "note.txt" })
      .expect(400);
    expect(wrongField.body).toMatchObject({
      error: "invalid_multipart_upload",
      reason: "LIMIT_UNEXPECTED_FILE"
    });

    const missingApiRoute = await request(app).get("/api/missing").expect(404);
    expect(missingApiRoute.body).toMatchObject({ error: "not_found" });
  });

  it("uses a 5 GB default upload limit", () => {
    expect(DEFAULT_MAX_UPLOAD_BYTES).toBe(5_000_000_000);
    expect(DEFAULT_MAX_UPLOAD_BYTES).toBe(MAX_SINGLE_PUT_UPLOAD_BYTES);
    expect(DEFAULT_MAX_HTML_UPLOAD_BYTES).toBe(25_000_000);
    expect(DEFAULT_MAX_CONCURRENT_UPLOADS).toBe(1);
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
      expect(body.toString("utf8")).toContain("#087451");
      expect(body.toString("utf8")).not.toContain("#0969da");
    }
  });

  it("keeps external uploads unavailable until browser access is configured", async () => {
    const { app } = setup();

    await request(app)
      .get("/uploads")
      .expect(503)
      .expect({
        error: "external_upload_unavailable",
        message: "External uploads are not configured."
      });
  });

  it("serves the Access-protected upload website with restrictive browser headers", async () => {
    const { app } = setup({
      externalUploadAuth: (_req, _res, next) => next()
    });

    const page = await request(app).get("/publish").expect(200);
    expect(page.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(page.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(page.headers["x-frame-options"]).toBe("DENY");
    expect(page.headers["cache-control"]).toBe("private, no-store");
    expect(page.text).toContain("Temporary uploads");
    expect(page.text).toContain("Files expire after 3 days.");
    expect(page.text).toContain("Authenticated");
    expect(page.text).toContain('aria-current="page">Publish');
    expect(page.text).toContain('class="suite-skip skip-link"');
    expect(page.text).toContain('id="upload-search"');
    expect(page.text).toContain('id="upload-expiry"');
    expect(page.text).toContain('id="upload-sort"');
    expect(page.text).not.toContain("Operator sign-in");
    const scriptPath = page.text.match(
      /\/publish\/assets\/[a-f0-9]{16}\/app\.js/
    )?.[0];
    const stylePath = page.text.match(
      /\/publish\/assets\/[a-f0-9]{16}\/app\.css/
    )?.[0];
    expect(scriptPath).toBeDefined();
    expect(stylePath).toBeDefined();

    await request(app).get("/publish/callback").expect(200);
    await request(app).get("/uploads").expect(200);

    const style = await request(app)
      .get(stylePath ?? "")
      .expect("content-type", /text\/css/)
      .expect("Cache-Control", "private, max-age=31536000, immutable")
      .expect(200);
    const script = await request(app)
      .get(scriptPath ?? "")
      .expect("content-type", /javascript/)
      .expect("Cache-Control", "private, max-age=31536000, immutable")
      .expect(200);
    expect(script.text).toContain('fetch("/api/auth/sign-out", { method: "POST" })');
    expect(script.text).toContain("destination.origin !== window.location.origin");
    expect(script.text).toContain('link.target = "_blank"');
    expect(script.text).toContain('link.rel = "noreferrer"');
    expect(script.text).toContain('link.removeAttribute("target")');
    expect(script.text).toContain("opens in a new tab");
    expect(script.text).toContain('affordance.textContent = external ? "↗" : "›"');
    expect(() => new Function(script.text)).not.toThrow();
    expect(page.text).not.toContain('id="open-url" href="#" target="_blank"');
    expect(style.text).toContain("@media (max-width: 439px)");
    expect(style.text).toContain("flex-wrap: wrap");
    await request(app)
      .get((stylePath ?? "").replace("/publish/", "/uploads/"))
      .expect("Cache-Control", "private, max-age=31536000, immutable")
      .expect(200);
    await request(app)
      .get((scriptPath ?? "").replace("/publish/", "/uploads/"))
      .expect("Cache-Control", "private, max-age=31536000, immutable")
      .expect(200);
    await request(app)
      .get("/uploads/app.js")
      .expect("Cache-Control", "private, no-store")
      .expect(200);
    for (const path of ["/publish/app.css", "/publish/app.js", "/uploads/app.css", "/uploads/app.js"]) {
      await request(app).get(path).expect("Cache-Control", "private, no-store").expect(200);
    }
  });

  it("stores authenticated external uploads as expiring files in the same storage", async () => {
    const now = new Date("2026-07-23T12:00:00.000Z");
    const { app, storage } = setup({
      externalUploadAuth: (_req, _res, next) => next(),
      maxHtmlUploadBytes: 4,
      now: () => now
    });

    const response = await request(app)
      .post("/api/external-uploads")
      .set("Host", "uploads.example")
      .set("Origin", "http://uploads.example")
      .attach("file", Buffer.from("<!doctype html><title>Shared</title>"), {
        filename: "shared.html",
        contentType: "text/html"
      })
      .expect(201);

    expect(response.body).toMatchObject({
      kind: "file",
      filename: "shared.html",
      contentType: "text/html",
      url: expect.stringMatching(
        /^https:\/\/html\.example\/files\/[A-Za-z0-9_-]{32}\/shared\.html$/
      ),
      expiresAt: "2026-07-26T12:00:00.000Z"
    });
    expect(storage.files.has(response.body.id)).toBe(true);
    expect(storage.pages.has(response.body.id)).toBe(false);
  });

  it("lists plans and files for the authenticated upload website", async () => {
    const now = new Date("2026-07-23T12:00:00.000Z");
    const { app } = setup({
      externalUploadAuth: (_req, _res, next) => next(),
      now: () => now
    });
    const planName =
      "recent-upload-browser-550e8400-e29b-41d4-a716-446655440000.html";

    const plan = await request(app)
      .post("/api/uploads")
      .set("Authorization", "Bearer test-upload-token")
      .field("project", "microservices")
      .attach("file", Buffer.from("<!doctype html><title>Recent</title>"), {
        filename: planName,
        contentType: "text/html"
      })
      .expect(201);
    const file = await request(app)
      .post("/api/external-uploads")
      .set("Host", "uploads.example")
      .set("Origin", "http://uploads.example")
      .attach("file", Buffer.from("notes"), {
        filename: "notes.txt",
        contentType: "text/plain"
      })
      .expect(201);

    const firstPage = await request(app)
      .get("/api/external-uploads?limit=1&kind=all")
      .expect("Cache-Control", "private, no-store")
      .expect(200);
    expect(firstPage.body.uploads).toHaveLength(1);
    expect(firstPage.body.nextCursor).toEqual(expect.any(String));

    const secondPage = await request(app)
      .get(
        `/api/external-uploads?limit=1&kind=all&cursor=${encodeURIComponent(firstPage.body.nextCursor)}`
      )
      .expect(200);
    expect(secondPage.body.uploads).toHaveLength(1);
    expect(secondPage.body.nextCursor).toBeUndefined();
    expect([
      ...firstPage.body.uploads,
      ...secondPage.body.uploads
    ]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: plan.body.id,
          kind: "html",
          filename: planName,
          url: `https://html.example/artifacts/${plan.body.id}`,
          updatedAt: now.toISOString(),
          project: "microservices"
        }),
        expect.objectContaining({
          id: file.body.id,
          kind: "file",
          filename: "notes.txt",
          url: `https://html.example/files/${file.body.id}/notes.txt`,
          expiresAt: "2026-07-26T12:00:00.000Z"
        })
      ])
    );

    const plans = await request(app)
      .get("/api/external-uploads?limit=25&kind=html")
      .expect(200);
    expect(plans.body).toMatchObject({
      uploads: [
        expect.objectContaining({
          id: plan.body.id,
          kind: "html"
        })
      ]
    });
    expect(plans.body.nextCursor).toBeUndefined();
  });

  it("rejects invalid upload listing pagination", async () => {
    const { app } = setup({
      externalUploadAuth: (_req, _res, next) => next()
    });

    await request(app)
      .get("/api/external-uploads?limit=101")
      .expect(400, {
        error: "invalid_pagination",
        message: "limit must be an integer between 1 and 100."
      });
    await request(app)
      .get("/api/external-uploads?cursor=not-a-cursor")
      .expect(400, {
        error: "invalid_pagination",
        message: "cursor is invalid."
      });
    for (const query of ["expiry=month", "sort=random", "q=x&q=y"]) {
      await request(app).get(`/api/external-uploads?${query}`).expect(400);
    }
  });

  it("promotes legacy cursors only for default listing criteria and emits v1 cursors", async () => {
    const now = new Date("2026-07-23T12:00:00.000Z");
    const { app, storage } = setup({
      externalUploadAuth: (_req, _res, next) => next(),
      now: () => now
    });
    for (const id of ["a".repeat(32), "b".repeat(32), "c".repeat(32)]) {
      storage.pages.set(id, {
        body: Buffer.from("<!doctype html>"),
        etag: `"${id}"`,
        lastModified: now,
        metadata: { bytes: 15, originalName: `${id[0]}.html`, sha256: id.repeat(2) }
      });
    }
    for (const id of ["x".repeat(32), "y".repeat(32), "z".repeat(32)]) {
      storage.files.set(id, {
        body: Buffer.from("file"),
        lastModified: now,
        metadata: {
          bytes: 4,
          originalName: `${id[0]}.txt`,
          sha256: id.repeat(2),
          contentType: "text/plain",
          expiresAt: new Date("2026-07-26T12:00:00.000Z")
        }
      });
    }
    const encodeLegacy = (key: string) => Buffer.from(JSON.stringify({
      updatedAt: now.toISOString(),
      key
    })).toString("base64url");
    const cases = [
      { kind: "all", key: `files/${"x".repeat(32)}` },
      { kind: "html", key: `pages/${"a".repeat(32)}.html` },
      { kind: "file", key: `files/${"x".repeat(32)}` }
    ] as const;

    for (const { kind, key } of cases) {
      const legacy = encodeLegacy(key);
      const promoted = await request(app)
        .get(`/api/external-uploads?limit=1&kind=${kind}&cursor=${encodeURIComponent(legacy)}`)
        .expect(200);
      expect(promoted.body.uploads).toHaveLength(1);
      expect(promoted.body.uploads[0].kind).toBe(kind === "all" ? "file" : kind);
      expect(promoted.body.nextCursor).toEqual(expect.any(String));
      const decoded = JSON.parse(
        Buffer.from(promoted.body.nextCursor, "base64url").toString("utf8")
      ) as { version: number; criteria: string; originalName: string };
      expect(decoded).toMatchObject({
        version: 1,
        criteria: JSON.stringify({ q: "", kind, expiry: "all", sort: "newest" })
      });
      expect(decoded.originalName).toEqual(expect.any(String));
    }

    const legacy = encodeLegacy(`files/${"x".repeat(32)}`);
    for (const criteria of ["q=alpha", "expiry=persistent", "sort=oldest"]) {
      await request(app)
        .get(`/api/external-uploads?${criteria}&cursor=${encodeURIComponent(legacy)}`)
        .expect(400, {
          error: "invalid_pagination",
          message: "legacy cursor requires default listing criteria."
        });
    }
  });

  it("binds upload cursors to normalized listing criteria", async () => {
    const { app } = setup({ externalUploadAuth: (_req, _res, next) => next() });
    await request(app)
      .post("/api/uploads")
      .set("Authorization", "Bearer test-upload-token")
      .attach("file", Buffer.from("<!doctype html>"), { filename: "plan.html", contentType: "text/html" })
      .expect(201);
    await request(app)
      .post("/api/external-uploads")
      .set("Host", "uploads.example")
      .set("Origin", "http://uploads.example")
      .attach("file", Buffer.from("notes"), { filename: "notes.txt", contentType: "text/plain" })
      .expect(201);
    const first = await request(app).get("/api/external-uploads?limit=1").expect(200);
    await request(app)
      .get(`/api/external-uploads?limit=1&q=notes&cursor=${encodeURIComponent(first.body.nextCursor)}`)
      .expect(400, { error: "invalid_pagination", message: "cursor does not match the current filters." });
  });

  it("applies search, expiry, kind, sorting, ties, and filtered pagination in the API test double", async () => {
    const now = new Date("2026-07-23T12:00:00.000Z");
    const { app, storage } = setup({
      externalUploadAuth: (_req, _res, next) => next(),
      now: () => now
    });
    const addPage = (id: string, filename: string, updatedAt: string) => {
      storage.pages.set(id, {
        body: Buffer.from("<!doctype html>"),
        etag: `"${id}"`,
        lastModified: new Date(updatedAt),
        metadata: { bytes: 15, originalName: filename, sha256: id.repeat(2) }
      });
    };
    const addFile = (id: string, filename: string, updatedAt: string, expiresAt: string) => {
      storage.files.set(id, {
        body: Buffer.from("file"),
        lastModified: new Date(updatedAt),
        metadata: {
          bytes: 4,
          originalName: filename,
          sha256: id.repeat(2),
          contentType: "text/plain",
          expiresAt: new Date(expiresAt)
        }
      });
    };
    addPage("a".repeat(32), "Zulu Plan.html", "2026-07-23T10:00:00.000Z");
    addPage("b".repeat(32), "Alpha Plan.html", "2026-07-23T09:00:00.000Z");
    addFile("c".repeat(32), "Beta Notes.txt", "2026-07-23T11:00:00.000Z", "2026-07-24T00:00:00.000Z");
    addFile("d".repeat(32), "Beta Archive.txt", "2026-07-23T09:00:00.000Z", "2026-07-26T12:00:00.000Z");
    addFile("e".repeat(32), "Expired.txt", "2026-07-23T12:00:00.000Z", "2026-07-23T11:59:59.000Z");

    const filenames = async (query: string) => {
      const listed = await request(app).get(`/api/external-uploads?limit=100&${query}`).expect(200);
      return (listed.body.uploads as Array<{ filename: string }>).map(({ filename }) => filename);
    };
    await expect(filenames("q=%20BETA%20")).resolves.toEqual(["Beta Notes.txt", "Beta Archive.txt"]);
    await expect(filenames("kind=html&sort=filename")).resolves.toEqual(["Alpha Plan.html", "Zulu Plan.html"]);
    await expect(filenames("expiry=24h&sort=expiry")).resolves.toEqual(["Beta Notes.txt"]);
    await expect(filenames("expiry=7d&sort=expiry")).resolves.toEqual(["Beta Notes.txt", "Beta Archive.txt"]);
    await expect(filenames("expiry=persistent&sort=oldest")).resolves.toEqual(["Alpha Plan.html", "Zulu Plan.html"]);
    await expect(filenames("sort=newest")).resolves.toEqual(["Beta Notes.txt", "Zulu Plan.html", "Beta Archive.txt", "Alpha Plan.html"]);
    await expect(filenames("sort=oldest")).resolves.toEqual(["Beta Archive.txt", "Alpha Plan.html", "Zulu Plan.html", "Beta Notes.txt"]);
    await expect(filenames("sort=filename")).resolves.toEqual(["Alpha Plan.html", "Beta Archive.txt", "Beta Notes.txt", "Zulu Plan.html"]);

    const first = await request(app)
      .get("/api/external-uploads?limit=2&sort=filename&q=plan")
      .expect(200);
    expect(first.body.uploads.map(({ filename }: { filename: string }) => filename)).toEqual([
      "Alpha Plan.html",
      "Zulu Plan.html"
    ]);
    expect(first.body.nextCursor).toBeUndefined();

    const tiedFirst = await request(app)
      .get("/api/external-uploads?limit=1&sort=oldest")
      .expect(200);
    const tiedSecond = await request(app)
      .get(`/api/external-uploads?limit=1&sort=oldest&cursor=${encodeURIComponent(tiedFirst.body.nextCursor)}`)
      .expect(200);
    expect(tiedFirst.body.uploads[0].filename).toBe("Beta Archive.txt");
    expect(tiedSecond.body.uploads[0].filename).toBe("Alpha Plan.html");
  });

  it("rejects cross-origin requests to the external upload endpoint", async () => {
    const { app, storage } = setup({
      externalUploadAuth: (_req, _res, next) => next()
    });

    const response = await request(app)
      .post("/api/external-uploads")
      .set("Host", "uploads.example")
      .set("Origin", "https://attacker.example")
      .attach("file", Buffer.from("private"), {
        filename: "private.txt",
        contentType: "text/plain"
      })
      .expect(403);

    expect(response.body).toMatchObject({ error: "invalid_origin" });
    expect(storage.files.size).toBe(0);
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
      kind: "file",
      filename: "note.txt",
      contentType: "text/plain",
      url: expect.stringMatching(/^https:\/\/html\.example\/files\/[A-Za-z0-9_-]{32}\/note\.txt$/),
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
    expect(downloadResponse.headers["content-length"]).toBe(String(text.length));
    expect(downloadResponse.headers.etag).toBe(
      `"sha256-${crypto.createHash("sha256").update(text).digest("hex")}"`
    );
    expect(downloadResponse.headers["accept-ranges"]).toBe("bytes");
    expect(downloadResponse.headers["cache-control"]).toBe("private, no-store");
  });

  it("preserves a UTF-8 multipart filename through upload and download", async () => {
    const { app, storage } = setup();
    const filename = "résumé-计划.pdf";
    const uploadResponse = await request(app)
      .post("/api/uploads")
      .set("Authorization", "Bearer test-upload-token")
      .attach("file", Buffer.from("pdf"), {
        filename,
        contentType: "application/pdf"
      })
      .expect(201);

    expect(uploadResponse.body.filename).toBe(filename);
    expect(new URL(uploadResponse.body.url).pathname).toBe(
      `/files/${uploadResponse.body.id}/${encodeURIComponent(filename)}`
    );
    expect(storage.files.get(uploadResponse.body.id)?.metadata.originalName).toBe(filename);

    const downloadResponse = await request(app)
      .get(new URL(uploadResponse.body.url).pathname)
      .expect(200);
    expect(downloadResponse.headers["content-disposition"]).toContain(
      `filename*=UTF-8''${encodeURIComponent(filename)}`
    );
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

  it("supports resumable ranges and metadata-only HEAD requests", async () => {
    const { app } = setup();
    const uploadResponse = await request(app)
      .post("/api/uploads")
      .set("Authorization", "Bearer test-upload-token")
      .attach("file", Buffer.from("hello"), {
        filename: "note.txt",
        contentType: "text/plain"
      })
      .expect(201);
    const downloadPath = new URL(uploadResponse.body.url).pathname;

    const rangeResponse = await request(app)
      .get(downloadPath)
      .set("Range", "bytes=1-3")
      .buffer(true)
      .parse(binaryParser)
      .expect(206);
    expect(rangeResponse.headers["content-range"]).toBe("bytes 1-3/5");
    expect(rangeResponse.headers["content-length"]).toBe("3");
    expect(Buffer.isBuffer(rangeResponse.body) && rangeResponse.body.toString()).toBe("ell");

    const headResponse = await request(app).head(downloadPath).expect(200);
    expect(headResponse.headers["content-length"]).toBe("5");
    expect(headResponse.text).toBeUndefined();

    const unsatisfied = await request(app)
      .get(downloadPath)
      .set("Range", "bytes=100-")
      .expect(416);
    expect(unsatisfied.headers["content-range"]).toBe("bytes */5");
    expect(unsatisfied.body).toMatchObject({ error: "range_not_satisfiable" });

    await request(app)
      .get(downloadPath)
      .set("Range", "bytes=0-1,3-4")
      .expect(416);
  });

  it("checks live, missing, and expired capabilities before rejecting a malformed range", async () => {
    let now = new Date("2026-07-10T12:00:00.000Z");
    const { app } = setup({ now: () => now, temporaryFileRetentionMs: 1000 });
    const uploadResponse = await request(app)
      .post("/api/uploads")
      .set("Authorization", "Bearer test-upload-token")
      .attach("file", Buffer.from("hello"), {
        filename: "note.txt",
        contentType: "text/plain"
      })
      .expect(201);
    const downloadPath = new URL(uploadResponse.body.url).pathname;

    const liveResponse = await request(app)
      .get(downloadPath)
      .set("Range", "bytes=0-1,3-4")
      .expect(416);
    expect(liveResponse.headers["content-range"]).toBe("bytes */5");

    await request(app)
      .get(`/f/${"a".repeat(32)}/note.txt`)
      .set("Range", "bytes=0-1,3-4")
      .expect(404);

    now = new Date("2026-07-10T12:00:01.001Z");
    await request(app)
      .get(downloadPath)
      .set("Range", "bytes=0-1,3-4")
      .expect(404);
  });

  it("honors strong If-Range ETags and ignores mismatching or weak validators", async () => {
    const { app } = setup();
    const body = Buffer.from("hello");
    const uploadResponse = await request(app)
      .post("/api/uploads")
      .set("Authorization", "Bearer test-upload-token")
      .attach("file", body, { filename: "note.txt", contentType: "text/plain" })
      .expect(201);
    const downloadPath = new URL(uploadResponse.body.url).pathname;
    const etag = `"sha256-${uploadResponse.body.sha256}"`;

    const matching = await request(app)
      .get(downloadPath)
      .set("Range", "bytes=1-3")
      .set("If-Range", etag)
      .buffer(true)
      .parse(binaryParser)
      .expect(206);
    expect(Buffer.isBuffer(matching.body) && matching.body.toString()).toBe("ell");

    for (const validator of [`"sha256-${"0".repeat(64)}"`, `W/${etag}`]) {
      const ignored = await request(app)
        .get(downloadPath)
        .set("Range", "bytes=1-3")
        .set("If-Range", validator)
        .buffer(true)
        .parse(binaryParser)
        .expect(200);
      expect(Buffer.isBuffer(ignored.body) && ignored.body.equals(body)).toBe(true);
      expect(ignored.headers["content-range"]).toBeUndefined();
    }
  });

  it("honors non-stale If-Range dates and ignores stale or invalid dates", async () => {
    const now = new Date("2026-07-10T12:00:00.500Z");
    const { app } = setup({ now: () => now });
    const body = Buffer.from("hello");
    const uploadResponse = await request(app)
      .post("/api/uploads")
      .set("Authorization", "Bearer test-upload-token")
      .attach("file", body, { filename: "note.txt", contentType: "text/plain" })
      .expect(201);
    const downloadPath = new URL(uploadResponse.body.url).pathname;

    const matching = await request(app)
      .get(downloadPath)
      .set("Range", "bytes=1-3")
      .set("If-Range", now.toUTCString())
      .buffer(true)
      .parse(binaryParser)
      .expect(206);
    expect(Buffer.isBuffer(matching.body) && matching.body.toString()).toBe("ell");

    for (const validator of ["Fri, 10 Jul 2026 11:59:59 GMT", "not-an-http-date"]) {
      const ignored = await request(app)
        .get(downloadPath)
        .set("Range", "bytes=1-3")
        .set("If-Range", validator)
        .buffer(true)
        .parse(binaryParser)
        .expect(200);
      expect(Buffer.isBuffer(ignored.body) && ignored.body.equals(body)).toBe(true);
      expect(ignored.headers["content-range"]).toBeUndefined();
    }
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

  it("uses a smaller HTML limit without reducing the temporary file limit", async () => {
    const { app } = setup({ maxUploadBytes: 100, maxHtmlUploadBytes: 8 });
    const content = Buffer.from("<html></html>");

    const htmlResponse = await request(app)
      .post("/api/uploads")
      .set("Authorization", "Bearer test-upload-token")
      .attach("file", content, { filename: "page.html", contentType: "text/html" })
      .expect(413);
    expect(htmlResponse.body).toMatchObject({ error: "html_payload_too_large" });

    await request(app)
      .post("/api/uploads")
      .set("Authorization", "Bearer test-upload-token")
      .attach("file", content, { filename: "page.txt", contentType: "text/plain" })
      .expect(201);
  });

  it("stores a valid html upload and returns a public url", async () => {
    const { app, storage } = setup();
    const html = Buffer.from("<!doctype html><html><body>Hello</body></html>");

    const response = await request(app)
      .post("/api/uploads")
      .set("Authorization", "Bearer test-upload-token")
      .field("project", "microservices")
      .attach("file", html, {
        filename: "page.html",
        contentType: "text/html"
      })
      .expect(201);

    expect(response.body).toMatchObject({
      kind: "html",
      filename: "page.html",
      contentType: "text/html; charset=utf-8",
      url: expect.stringMatching(/^https:\/\/html\.example\/artifacts\/[A-Za-z0-9_-]{32}$/),
      bytes: html.length,
      sha256: crypto.createHash("sha256").update(html).digest("hex"),
      project: "microservices"
    });
    expect(response.body.id).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(storage.pages.get(response.body.id)?.body.equals(html)).toBe(true);
    expect(storage.pages.get(response.body.id)?.metadata.bytes).toBe(html.length);
    expect(storage.pages.get(response.body.id)?.metadata.project).toBe("microservices");
  });

  it("rejects invalid project metadata without storing the plan", async () => {
    const { app, storage } = setup();

    const response = await request(app)
      .post("/api/uploads")
      .set("Authorization", "Bearer test-upload-token")
      .field("project", "   ")
      .attach("file", Buffer.from("<html>plan</html>"), {
        filename: "page.html",
        contentType: "text/html"
      })
      .expect(400);

    expect(response.body).toMatchObject({ error: "invalid_project" });
    expect(storage.pages.size).toBe(0);
  });

  it("updates an HTML page in place with refreshed representation metadata", async () => {
    let now = new Date("2026-07-10T12:00:00.000Z");
    const { app, storage } = setup({ now: () => now });
    const first = Buffer.from("<!doctype html><title>First</title>");
    const second = Buffer.from("<!doctype html><title>Second version</title>");

    const created = await request(app)
      .post("/api/uploads")
      .set("Authorization", "Bearer test-upload-token")
      .field("project", "microservices")
      .attach("file", first, { filename: "first.html", contentType: "text/html" })
      .expect(201);
    const pagePath = new URL(created.body.url).pathname;
    const firstRead = await request(app).get(pagePath).expect(200);

    now = new Date("2026-07-10T12:01:00.000Z");
    const updated = await request(app)
      .put(`/api/uploads/${created.body.id}`)
      .set("Authorization", "Bearer test-upload-token")
      .attach("file", second, { filename: "revised.html", contentType: "text/html" })
      .expect(200);

    expect(updated.body).toMatchObject({
      id: created.body.id,
      kind: "html",
      filename: "revised.html",
      contentType: "text/html; charset=utf-8",
      url: created.body.url,
      bytes: second.length,
      sha256: crypto.createHash("sha256").update(second).digest("hex"),
      project: "microservices"
    });
    expect(storage.pages.size).toBe(1);
    expect(storage.pages.get(created.body.id)?.metadata).toMatchObject({
      bytes: second.length,
      originalName: "revised.html",
      sha256: updated.body.sha256,
      project: "microservices"
    });

    const secondRead = await request(app)
      .get(pagePath)
      .set("If-None-Match", firstRead.headers.etag)
      .expect(200);
    expect(secondRead.text).toBe(second.toString());
    expect(secondRead.headers.etag).toBe(`"sha256-${updated.body.sha256}"`);
    expect(secondRead.headers.etag).not.toBe(firstRead.headers.etag);
    expect(secondRead.headers["content-length"]).toBe(String(second.length));
    expect(secondRead.headers["last-modified"]).toBe(now.toUTCString());
    expect(secondRead.headers["last-modified"]).not.toBe(firstRead.headers["last-modified"]);

    await request(app)
      .get(pagePath)
      .set("If-None-Match", secondRead.headers.etag)
      .expect(304);
  });

  it("does not recreate a page revoked during an update", async () => {
    const storage = new DeleteBeforeConditionalHtmlWriteStorage();
    const app = createApp({
      storage,
      uploadToken: "test-upload-token",
      publicBaseUrl: "https://html.example"
    });
    const created = await request(app)
      .post("/api/uploads")
      .set("Authorization", "Bearer test-upload-token")
      .attach("file", Buffer.from("<html>original</html>"), {
        filename: "page.html",
        contentType: "text/html"
      })
      .expect(201);

    const update = await request(app)
      .put(`/api/uploads/${created.body.id}`)
      .set("Authorization", "Bearer test-upload-token")
      .attach("file", Buffer.from("<html>replacement</html>"), {
        filename: "page.html",
        contentType: "text/html"
      })
      .expect(409);

    expect(update.body).toMatchObject({ error: "upload_conflict" });
    expect(storage.pages.has(created.body.id)).toBe(false);
    await request(app).get(`/p/${created.body.id}`).expect(404);
  });

  it("fails closed for unauthorized, invalid, missing, and non-HTML update targets", async () => {
    const { app, storage } = setup();
    const created = await request(app)
      .post("/api/uploads")
      .set("Authorization", "Bearer test-upload-token")
      .attach("file", Buffer.from("<html>original</html>"), {
        filename: "page.html",
        contentType: "text/html"
      })
      .expect(201);

    await request(app)
      .put(`/api/uploads/${created.body.id}`)
      .attach("file", Buffer.from("<html>new</html>"), {
        filename: "page.html",
        contentType: "text/html"
      })
      .expect(401);
    await request(app)
      .put("/api/uploads/not-valid")
      .set("Authorization", "Bearer test-upload-token")
      .attach("file", Buffer.from("<html>new</html>"), {
        filename: "page.html",
        contentType: "text/html"
      })
      .expect(400, { error: "invalid_upload_id", message: "Upload ID is invalid." });

    const missing = await request(app)
      .put(`/api/uploads/${"a".repeat(32)}`)
      .set("Authorization", "Bearer test-upload-token")
      .attach("file", Buffer.from("<html>new</html>"), {
        filename: "page.html",
        contentType: "text/html"
      })
      .expect(404);
    expect(missing.body).toMatchObject({ error: "upload_not_found" });

    const nonHtml = await request(app)
      .put(`/api/uploads/${created.body.id}`)
      .set("Authorization", "Bearer test-upload-token")
      .attach("file", Buffer.from("not html"), {
        filename: "page.txt",
        contentType: "text/plain"
      })
      .expect(400);
    expect(nonHtml.body).toMatchObject({ error: "html_upload_required" });
    expect(storage.pages.get(created.body.id)?.body.toString()).toBe("<html>original</html>");
  });

  it("applies multipart, HTML size, and concurrency safeguards to updates", async () => {
    const storage = new BlockingHtmlUpdateStorage();
    const app = createApp({
      storage,
      uploadToken: "test-upload-token",
      publicBaseUrl: "https://html.example",
      maxUploadBytes: 100,
      maxHtmlUploadBytes: 20,
      maxConcurrentUploads: 1
    });
    const created = await request(app)
      .post("/api/uploads")
      .set("Authorization", "Bearer test-upload-token")
      .attach("file", Buffer.from("<html></html>"), {
        filename: "page.html",
        contentType: "text/html"
      })
      .expect(201);

    const unsupported = await request(app)
      .put(`/api/uploads/${created.body.id}`)
      .set("Authorization", "Bearer test-upload-token")
      .send("not multipart")
      .expect(415);
    expect(unsupported.body).toMatchObject({ error: "unsupported_media_type" });

    const oversized = await request(app)
      .put(`/api/uploads/${created.body.id}`)
      .set("Authorization", "Bearer test-upload-token")
      .attach("file", Buffer.from(`<html>${"x".repeat(20)}</html>`), {
        filename: "page.html",
        contentType: "text/html"
      })
      .expect(413);
    expect(oversized.body).toMatchObject({ error: "html_payload_too_large" });

    storage.blockUpdates = true;
    const firstUpdate = request(app)
      .put(`/api/uploads/${created.body.id}`)
      .set("Authorization", "Bearer test-upload-token")
      .attach("file", Buffer.from("<html>1</html>"), {
        filename: "page.html",
        contentType: "text/html"
      })
      .then((response) => response);
    await storage.waitUntilStarted();

    const busy = await request(app)
      .put(`/api/uploads/${created.body.id}`)
      .set("Authorization", "Bearer test-upload-token")
      .attach("file", Buffer.from("<html>2</html>"), {
        filename: "page.html",
        contentType: "text/html"
      })
      .expect(503);
    expect(busy.body).toMatchObject({ error: "upload_capacity_reached" });
    storage.releaseUpdate();
    expect((await firstUpdate).status).toBe(200);
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
      url: expect.stringMatching(/^https:\/\/html\.example\/files\/[A-Za-z0-9_-]{32}\/release\.apk$/),
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

    const response = await request(app)
      .get(`/artifacts/${uploadResponse.body.id}`)
      .expect(200);

    expect(response.text).toBe(html);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["content-security-policy"]).toBe(
      "sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads"
    );
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(response.headers["cache-control"]).toBe("private, no-cache");
    expect(response.headers["content-length"]).toBe(String(Buffer.byteLength(html)));
    expect(response.headers.etag).toBe(`"sha256-${uploadResponse.body.sha256}"`);

    const headResponse = await request(app)
      .head(`/artifacts/${uploadResponse.body.id}`)
      .expect(200);
    expect(headResponse.headers["content-length"]).toBe(String(Buffer.byteLength(html)));
    expect(headResponse.text).toBeUndefined();

    await request(app)
      .get(`/artifacts/${uploadResponse.body.id}`)
      .set("If-None-Match", response.headers.etag)
      .expect(304);
  });

  it("returns 404 for invalid or missing public ids", async () => {
    const { app } = setup();

    await request(app).get("/p/not-valid").expect(404);
    await request(app).get("/artifacts/not-valid").expect(404);
    await request(app).get("/p/0123456789abcdefghijklmnopqrstuv").expect(404);
    await request(app).get("/f/not-valid/release.apk").expect(404);
    await request(app).get("/files/not-valid/release.apk").expect(404);
  });

  it("maps malformed path encoding to capability-safe client errors", async () => {
    const { app } = setup();
    const id = "a".repeat(32);

    await request(app).get("/p/%ZZ").expect(404);
    await request(app).get(`/f/${id}/%ZZ`).expect(404);
    await request(app).get("/artifacts/%ZZ").expect(404);
    await request(app).get(`/files/${id}/%ZZ`).expect(404);

    await request(app).delete("/api/uploads/%ZZ").expect(401);
    const deleteResponse = await request(app)
      .delete("/api/uploads/%ZZ")
      .set("Authorization", "Bearer test-upload-token")
      .expect(400);
    expect(deleteResponse.body).toMatchObject({ error: "invalid_upload_id" });

    await request(app).put("/api/uploads/%ZZ").expect(401);
    const updateResponse = await request(app)
      .put("/api/uploads/%ZZ")
      .set("Authorization", "Bearer test-upload-token")
      .expect(400);
    expect(updateResponse.body).toMatchObject({ error: "invalid_upload_id" });
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
    await request(app)
      .get(new URL(uploadResponse.body.url).pathname)
      .set("Range", "bytes=100-")
      .expect(404);
  });

  it("aborts pending HTML and file storage reads when the client disconnects", async () => {
    await expectCancelledStorageRead("html");
    await expectCancelledStorageRead("file");
  });

  it("bounds concurrent uploads and tells callers when to retry", async () => {
    const storage = new BlockingUploadStorage();
    const app = createApp({
      storage,
      uploadToken: "test-upload-token",
      publicBaseUrl: "https://html.example",
      maxConcurrentUploads: 1
    });

    const firstUpload = request(app)
      .post("/api/uploads")
      .set("Authorization", "Bearer test-upload-token")
      .attach("file", Buffer.from("first"), {
        filename: "first.txt",
        contentType: "text/plain"
      })
      .then((response) => response);
    await storage.waitUntilStarted();

    const busyResponse = await request(app)
      .post("/api/uploads")
      .set("Authorization", "Bearer test-upload-token")
      .attach("file", Buffer.from("second"), {
        filename: "second.txt",
        contentType: "text/plain"
      })
      .expect(503);
    expect(busyResponse.headers["retry-after"]).toBe("1");
    expect(busyResponse.headers.connection).toBe("close");
    expect(busyResponse.body).toMatchObject({ error: "upload_capacity_reached" });

    storage.releaseUpload();
    expect((await firstUpload).status).toBe(201);
  });

  it("removes a possibly committed object when an upload operation fails", async () => {
    const storage = new CommitThenFailStorage();
    const app = createApp({
      storage,
      uploadToken: "test-upload-token",
      publicBaseUrl: "https://html.example"
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await request(app)
      .post("/api/uploads")
      .set("Authorization", "Bearer test-upload-token")
      .attach("file", Buffer.from("<html></html>"), {
        filename: "page.html",
        contentType: "text/html"
      })
      .expect(500);
    consoleError.mockRestore();

    expect(response.body).toMatchObject({ error: "internal_server_error" });
    expect(storage.deletedIds).toHaveLength(1);
    expect(storage.pages.size).toBe(0);
  });

  it("never deletes or revokes a stable page when an update fails", async () => {
    for (const failure of ["before-commit", "after-commit"] as const) {
      const storage = new UpdateFailureStorage();
      const app = createApp({
        storage,
        uploadToken: "test-upload-token",
        publicBaseUrl: "https://html.example"
      });
      const original = Buffer.from("<html>original</html>");
      const replacement = Buffer.from("<html>replacement</html>");
      const created = await request(app)
        .post("/api/uploads")
        .set("Authorization", "Bearer test-upload-token")
        .attach("file", original, { filename: "page.html", contentType: "text/html" })
        .expect(201);

      storage.failure = failure;
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
      await request(app)
        .put(`/api/uploads/${created.body.id}`)
        .set("Authorization", "Bearer test-upload-token")
        .attach("file", replacement, {
          filename: "page.html",
          contentType: "text/html"
        })
        .expect(500);
      consoleError.mockRestore();

      expect(storage.deletedIds).toEqual([]);
      const page = await request(app).get(`/p/${created.body.id}`).expect(200);
      expect([original.toString(), replacement.toString()]).toContain(page.text);
      expect(storage.pages.size).toBe(1);
    }
  });

  it("aborts interrupted updates without deleting the stable page", async () => {
    const storage = new AbortAwareUpdateStorage();
    const app = createApp({
      storage,
      uploadToken: "test-upload-token",
      publicBaseUrl: "https://html.example"
    });
    const created = await request(app)
      .post("/api/uploads")
      .set("Authorization", "Bearer test-upload-token")
      .attach("file", Buffer.from("<html>original</html>"), {
        filename: "page.html",
        contentType: "text/html"
      })
      .expect(201);
    storage.observeUpdates = true;

    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const boundary = "interrupted-update-boundary";
    const body = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="page.html"\r\nContent-Type: text/html\r\n\r\n<html>replacement</html>\r\n--${boundary}--\r\n`
    );
    const clientRequest = http.request({
      host: "127.0.0.1",
      port: address.port,
      path: `/api/uploads/${created.body.id}`,
      method: "PUT",
      headers: {
        Authorization: "Bearer test-upload-token",
        "Content-Length": body.length,
        "Content-Type": `multipart/form-data; boundary=${boundary}`
      }
    });
    clientRequest.on("error", () => undefined);
    clientRequest.end(body);

    try {
      await storage.waitUntilStarted();
      clientRequest.destroy();
      await storage.waitUntilAborted();
      expect(storage.deletedIds).toEqual([]);
      expect(storage.pages.get(created.body.id)?.body.toString()).toBe("<html>original</html>");
    } finally {
      clientRequest.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("tracks interrupted upload cleanup until compensating deletion settles", async () => {
    const storage = new BlockingCleanupAfterCommitStorage();
    const activityTracker = new ActivityTracker();
    const app = createApp({
      activityTracker,
      storage,
      uploadToken: "test-upload-token",
      publicBaseUrl: "https://html.example"
    });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const boundary = "activity-tracker-boundary";
    const body = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="page.html"\r\nContent-Type: text/html\r\n\r\n<html></html>\r\n--${boundary}--\r\n`
    );
    const clientRequest = http.request({
      host: "127.0.0.1",
      port: address.port,
      path: "/api/uploads",
      method: "POST",
      headers: {
        Authorization: "Bearer test-upload-token",
        "Content-Length": body.length,
        "Content-Type": `multipart/form-data; boundary=${boundary}`
      }
    });
    clientRequest.on("error", () => undefined);
    clientRequest.end(body);

    try {
      await storage.waitUntilCleanupStarted();
      const disconnected = new Promise<void>((resolve) => {
        clientRequest.once("close", resolve);
      });
      clientRequest.destroy();
      await disconnected;

      let idle = false;
      const waiting = activityTracker.waitForIdle().then(() => {
        idle = true;
      });
      await Promise.resolve();
      expect(idle).toBe(false);

      storage.releaseCleanup();
      await waiting;
      expect(storage.pages.size).toBe(0);
    } finally {
      storage.releaseCleanup();
      clientRequest.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("revokes published pages and temporary files through the authenticated API", async () => {
    const { app, storage } = setup();
    const htmlUpload = await request(app)
      .post("/api/uploads")
      .set("Authorization", "Bearer test-upload-token")
      .attach("file", Buffer.from("<html></html>"), {
        filename: "page.html",
        contentType: "text/html"
      })
      .expect(201);
    const fileUpload = await request(app)
      .post("/api/uploads")
      .set("Authorization", "Bearer test-upload-token")
      .attach("file", Buffer.from("hello"), {
        filename: "note.txt",
        contentType: "text/plain"
      })
      .expect(201);

    for (const upload of [htmlUpload.body, fileUpload.body]) {
      await request(app)
        .delete(`/api/uploads/${upload.id}`)
        .set("Authorization", "Bearer test-upload-token")
        .expect(204);
      await request(app).get(new URL(upload.url).pathname).expect(404);
    }

    expect(storage.pages.size).toBe(0);
    expect(storage.files.size).toBe(0);
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
    expect(await storage.deleteExpiredTemporaryFiles(new Date("2026-07-10T11:59:59.999Z"))).toBe(
      0
    );

    now = new Date("2026-07-10T12:00:00.001Z");
    expect(await storage.deleteExpiredTemporaryFiles(now)).toBe(
      1
    );
    expect(storage.files.has(uploadResponse.body.id)).toBe(false);
  });
});

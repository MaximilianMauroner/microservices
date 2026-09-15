import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { ActivityTracker } from "../src/activity-tracker.js";
import {
  CHUNKED_UPLOAD_MAX_CHUNK_BYTES,
  CHUNKED_UPLOAD_MIN_CHUNK_BYTES,
  createFetchApp
} from "../src/fetch-app.js";
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
import type { UploadLinkRepository } from "../src/upload-links.js";

const ORIGIN = "https://tools.example.test";
const CHUNK_BYTES = 1024 * 1024;
const DROP_TOKEN = "u".repeat(43);
const DROP_LINK_ID = "123e4567-e89b-42d3-a456-426614174000";

class ChunkTestStorage implements UploadStorage {
  readonly files = new Map<string, { body: Buffer; metadata: PutTemporaryFileMetadata }>();

  async putHtml(_id: string, _filePath: string, _metadata: PutHtmlMetadata, _options?: PutHtmlOptions) {
    throw new Error("not implemented");
  }

  async getHtml(_id: string, _options?: GetStoredObjectOptions): Promise<StoredHtml | null> {
    return null;
  }

  async putTemporaryFile(id: string, filePath: string, metadata: PutTemporaryFileMetadata) {
    this.files.set(id, { body: await readFile(filePath), metadata });
  }

  async getTemporaryFile(id: string, _options?: GetTemporaryFileOptions): Promise<StoredTemporaryFile | null> {
    const file = this.files.get(id);
    if (!file) return null;
    return {
      body: Readable.from([file.body]),
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

  async updateHtmlProject(_id: string, _project: string) {
    return false;
  }

  async updateFileExpiry(_id: string, _expiresAt: Date | null) {
    return false;
  }

  async deleteUpload(id: string, _options?: StorageOperationOptions) {
    this.files.delete(id);
  }

  async deleteExpiredTemporaryFiles(_expiresAtOrBefore: Date, _options?: StorageOperationOptions) {
    return 0;
  }
}

function testApp(storage: UploadStorage, overrides: Record<string, unknown> = {}) {
  return createFetchApp({
    storage,
    activityTracker: new ActivityTracker(),
    uploadToken: "upload-token",
    publicBaseUrl: ORIGIN,
    externalUpload: true,
    now: () => new Date("2026-08-14T12:00:00.000Z"),
    ...overrides
  });
}

function guestLinks(): UploadLinkRepository {
  const link = {
    id: DROP_LINK_ID,
    createdAt: new Date("2026-08-14T12:00:00.000Z"),
    expiresAt: new Date("2026-08-21T12:00:00.000Z"),
    fileCount: 0
  };
  return {
    async create() { return { ...link, token: DROP_TOKEN }; },
    async list() { return [link]; },
    async find(token) { return token === DROP_TOKEN ? link : null; },
    async findActive(token) { return token === DROP_TOKEN ? link : null; },
    async listFiles() { return []; },
    async revoke() { return true; }
  };
}

function initBody(totalBytes: number, totalChunks: number, chunkBytes = CHUNK_BYTES) {
  return JSON.stringify({
    filename: "backup.bin",
    contentType: "application/octet-stream",
    totalBytes,
    totalChunks,
    chunkBytes
  });
}

async function initSession(
  app: ReturnType<typeof createFetchApp>,
  totalBytes: number,
  totalChunks: number,
  chunkBytes = CHUNK_BYTES
) {
  const response = await app(
    new Request(`${ORIGIN}/api/external-uploads/chunks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: initBody(totalBytes, totalChunks, chunkBytes)
    })
  );
  const payload = (await response.json()) as { sessionId: string };
  expect(response.status).toBe(201);
  return payload.sessionId;
}

async function initNativeSession(
  app: ReturnType<typeof createFetchApp>,
  totalBytes: number,
  totalChunks: number,
  chunkBytes = CHUNK_BYTES
) {
  const response = await app(
    new Request(`${ORIGIN}/api/uploads/chunks`, {
      method: "POST",
      headers: {
        Authorization: "Bearer upload-token",
        "Content-Type": "application/json"
      },
      body: initBody(totalBytes, totalChunks, chunkBytes)
    })
  );
  const payload = (await response.json()) as { sessionId: string };
  expect(response.status).toBe(201);
  return payload.sessionId;
}

describe("chunked browser uploads", () => {
  it("reassembles capability-scoped guest chunks and attributes the file", async () => {
    const storage = new ChunkTestStorage();
    const app = testApp(storage, { uploadLinks: guestLinks() });
    const totalBytes = CHUNK_BYTES * 2;
    const content = Buffer.alloc(totalBytes, 9);
    const base = `${ORIGIN}/api/drop/${DROP_TOKEN}/uploads/chunks`;
    const initialized = await app(new Request(base, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: initBody(totalBytes, 2)
    }));
    expect(initialized.status).toBe(201);
    const { sessionId } = await initialized.json() as { sessionId: string };

    for (let index = 0; index < 2; index += 1) {
      const response = await app(new Request(`${base}/${sessionId}/${index}`, {
        method: "PUT",
        headers: { Origin: ORIGIN, "Content-Type": "application/octet-stream" },
        body: content.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES)
      }));
      expect(response.status).toBe(200);
    }
    const completed = await app(new Request(`${base}/${sessionId}/complete`, {
      method: "POST",
      headers: { Origin: ORIGIN }
    }));
    expect(completed.status).toBe(201);
    const payload = await completed.json() as { id: string; expiresAt: string };
    expect(storage.files.get(payload.id)?.metadata.uploadLinkId).toBe(DROP_LINK_ID);
    expect(storage.files.get(payload.id)?.body.equals(content)).toBe(true);
    expect(payload.expiresAt).toBe("2026-08-21T12:00:00.000Z");
  });

  it("revalidates a guest capability before committing a chunked upload", async () => {
    const storage = new ChunkTestStorage();
    const links = guestLinks();
    const findActive = links.findActive.bind(links);
    let activeChecks = 0;
    links.findActive = async (token, now) => {
      activeChecks += 1;
      return activeChecks <= 4 ? findActive(token, now) : null;
    };
    const app = testApp(storage, { uploadLinks: links });
    const base = `${ORIGIN}/api/drop/${DROP_TOKEN}/uploads/chunks`;
    const initialized = await app(new Request(base, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: initBody(CHUNK_BYTES * 2, 2)
    }));
    const { sessionId } = await initialized.json() as { sessionId: string };
    for (let index = 0; index < 2; index += 1) {
      expect((await app(new Request(`${base}/${sessionId}/${index}`, {
        method: "PUT",
        headers: { Origin: ORIGIN, "Content-Type": "application/octet-stream" },
        body: Buffer.alloc(CHUNK_BYTES, index)
      }))).status).toBe(200);
    }

    const completed = await app(new Request(`${base}/${sessionId}/complete`, {
      method: "POST",
      headers: { Origin: ORIGIN }
    }));

    expect(completed.status).toBe(404);
    expect(await completed.json()).toMatchObject({ error: "upload_link_unavailable" });
    expect(storage.files.size).toBe(0);
  });

  it("bounds incomplete guest sessions and frees capacity when one is cancelled", async () => {
    const storage = new ChunkTestStorage();
    const app = testApp(storage, { uploadLinks: guestLinks() });
    const base = `${ORIGIN}/api/drop/${DROP_TOKEN}/uploads/chunks`;
    const sessions: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const response = await app(new Request(base, {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: initBody(CHUNK_BYTES * 2, 2)
      }));
      expect(response.status).toBe(201);
      sessions.push(((await response.json()) as { sessionId: string }).sessionId);
    }
    const limited = await app(new Request(base, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: initBody(CHUNK_BYTES * 2, 2)
    }));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ error: "too_many_incomplete_uploads" });

    expect((await app(new Request(`${base}/${sessions.shift()}`, {
      method: "DELETE", headers: { Origin: ORIGIN }
    }))).status).toBe(204);
    const replacement = await app(new Request(base, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: initBody(CHUNK_BYTES * 2, 2)
    }));
    expect(replacement.status).toBe(201);
    sessions.push(((await replacement.json()) as { sessionId: string }).sessionId);
    for (const sessionId of sessions) {
      await app(new Request(`${base}/${sessionId}`, { method: "DELETE", headers: { Origin: ORIGIN } }));
    }
  });

  it("bounds the pending guest initialization queue", async () => {
    const storage = new ChunkTestStorage();
    const app = testApp(storage, { uploadLinks: guestLinks() });
    const base = `${ORIGIN}/api/drop/${DROP_TOKEN}/uploads/chunks`;
    const responses = await Promise.all(Array.from({ length: 24 }, () => app(new Request(base, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: initBody(CHUNK_BYTES * 2, 2)
    }))));
    const payloads = await Promise.all(responses.map(async (response) => ({
      status: response.status,
      body: await response.json() as { error?: string; sessionId?: string }
    })));

    expect(payloads.filter(({ body }) => body.error === "upload_initialization_busy").length).toBeGreaterThan(0);
    const sessions = payloads.flatMap(({ status, body }) => status === 201 && body.sessionId ? [body.sessionId] : []);
    expect(sessions).toHaveLength(3);
    for (const sessionId of sessions) {
      await app(new Request(`${base}/${sessionId}`, { method: "DELETE", headers: { Origin: ORIGIN } }));
    }
  });

  it("removes aborted requests from the guest initialization queue", async () => {
    const source = await readFile(new URL("../src/fetch-app.ts", import.meta.url), "utf8");
    const gate = source.slice(
      source.indexOf("function createDropChunkInitGate"),
      source.indexOf("async function readLimitedBody")
    );
    expect(gate).toContain("pending.length >= maxPending");
    expect(gate).toContain("pending.splice(index, 1)");
    expect(gate).toContain('signal.addEventListener("abort", job.abort, { once: true })');
  });

  it("bounds concurrent guest chunk writes and releases capacity", async () => {
    const storage = new ChunkTestStorage();
    const app = testApp(storage, { uploadLinks: guestLinks(), guestUploadBodyTimeoutMs: 10_000 });
    const base = `${ORIGIN}/api/drop/${DROP_TOKEN}/uploads/chunks`;
    const initialized = await app(new Request(base, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: initBody(CHUNK_BYTES * 10, 10)
    }));
    const { sessionId } = await initialized.json() as { sessionId: string };
    const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
    const stalled: Promise<Response>[] = [];
    for (let index = 0; index < 8; index += 1) {
      const body = new ReadableStream<Uint8Array>({
        start(controller) { controllers.push(controller); controller.enqueue(new Uint8Array([1])); }
      });
      stalled.push(app(new Request(`${base}/${sessionId}/${index}`, {
        method: "PUT",
        headers: { Origin: ORIGIN, "Content-Type": "application/octet-stream" },
        body,
        duplex: "half"
      } as RequestInit)));
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    const rejected = await app(new Request(`${base}/${sessionId}/8`, {
      method: "PUT",
      headers: { Origin: ORIGIN, "Content-Type": "application/octet-stream" },
      body: Buffer.alloc(CHUNK_BYTES, 8)
    }));
    expect(rejected.status).toBe(503);
    expect(rejected.headers.get("retry-after")).toBe("1");
    expect(await rejected.json()).toMatchObject({ error: "upload_capacity_reached" });

    controllers.forEach((controller) => controller.close());
    const stalledResponses = await Promise.all(stalled);
    expect(stalledResponses.every((response) => response.status === 400)).toBe(true);
    const retried = await app(new Request(`${base}/${sessionId}/0`, {
      method: "PUT",
      headers: { Origin: ORIGIN, "Content-Type": "application/octet-stream" },
      body: Buffer.alloc(CHUNK_BYTES, 1)
    }));
    expect(retried.status).toBe(200);
    await app(new Request(`${base}/${sessionId}`, { method: "DELETE", headers: { Origin: ORIGIN } }));
  });

  it("reassembles small chunk requests into one temporary file", async () => {
    const storage = new ChunkTestStorage();
    const app = testApp(storage);
    const totalBytes = CHUNK_BYTES * 2 + 100;
    const content = Buffer.alloc(totalBytes, 7);
    const sessionId = await initSession(app, totalBytes, 3);

    for (let index = 0; index < 3; index += 1) {
      const start = index * CHUNK_BYTES;
      const end = Math.min(start + CHUNK_BYTES, totalBytes);
      const response = await app(
        new Request(`${ORIGIN}/api/external-uploads/chunks/${sessionId}/${index}`, {
          method: "PUT",
          headers: { Origin: ORIGIN, "Content-Type": "application/octet-stream" },
          body: content.subarray(start, end)
        })
      );
      expect(response.status).toBe(200);
    }

    const complete = await app(
      new Request(`${ORIGIN}/api/external-uploads/chunks/${sessionId}/complete`, {
        method: "POST",
        headers: { Origin: ORIGIN }
      })
    );
    const payload = (await complete.json()) as {
      id: string;
      kind: string;
      filename: string;
      bytes: number;
      url: string;
      expiresAt: string;
    };
    expect(complete.status).toBe(201);
    expect(payload).toMatchObject({ kind: "file", filename: "backup.bin", bytes: totalBytes });
    expect(payload.url).toContain(`/files/${payload.id}/backup.bin`);
    expect(storage.files.get(payload.id)?.body.equals(content)).toBe(true);
  });

  it("reports missing chunks so the client can resume them", async () => {
    const storage = new ChunkTestStorage();
    const app = testApp(storage);
    const totalBytes = CHUNK_BYTES * 2;
    const content = Buffer.alloc(totalBytes, 3);
    const sessionId = await initSession(app, totalBytes, 2);

    const first = await app(
      new Request(`${ORIGIN}/api/external-uploads/chunks/${sessionId}/0`, {
        method: "PUT",
        headers: { Origin: ORIGIN, "Content-Type": "application/octet-stream" },
        body: content.subarray(0, CHUNK_BYTES)
      })
    );
    expect(first.status).toBe(200);

    const incomplete = await app(
      new Request(`${ORIGIN}/api/external-uploads/chunks/${sessionId}/complete`, {
        method: "POST",
        headers: { Origin: ORIGIN }
      })
    );
    expect(incomplete.status).toBe(409);
    expect(await incomplete.json()).toMatchObject({ error: "incomplete_upload", missing: [1] });

    const second = await app(
      new Request(`${ORIGIN}/api/external-uploads/chunks/${sessionId}/1`, {
        method: "PUT",
        headers: { Origin: ORIGIN, "Content-Type": "application/octet-stream" },
        body: content.subarray(CHUNK_BYTES)
      })
    );
    expect(second.status).toBe(200);

    const complete = await app(
      new Request(`${ORIGIN}/api/external-uploads/chunks/${sessionId}/complete`, {
        method: "POST",
        headers: { Origin: ORIGIN }
      })
    );
    expect(complete.status).toBe(201);
    const payload = (await complete.json()) as { id: string };
    expect(storage.files.get(payload.id)?.body.equals(content)).toBe(true);
  });

  it("rejects a chunk with the wrong byte size", async () => {
    const storage = new ChunkTestStorage();
    const app = testApp(storage);
    const sessionId = await initSession(app, CHUNK_BYTES * 2, 2);

    const response = await app(
      new Request(`${ORIGIN}/api/external-uploads/chunks/${sessionId}/0`, {
        method: "PUT",
        headers: { Origin: ORIGIN, "Content-Type": "application/octet-stream" },
        body: Buffer.alloc(10, 1)
      })
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_chunk" });
  });

  it("rejects a total larger than the configured limit", async () => {
    const storage = new ChunkTestStorage();
    const app = testApp(storage, { maxUploadBytes: CHUNK_BYTES });
    const response = await app(
      new Request(`${ORIGIN}/api/external-uploads/chunks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN },
        body: initBody(CHUNK_BYTES * 2, 2)
      })
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: "payload_too_large" });
  });

  it("rejects chunk plans that do not cover the total", async () => {
    const storage = new ChunkTestStorage();
    const app = testApp(storage);
    const response = await app(
      new Request(`${ORIGIN}/api/external-uploads/chunks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN },
        body: initBody(CHUNK_BYTES * 2, 3)
      })
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_chunk_plan" });
  });

  it("aborts a session and forgets its chunks", async () => {
    const storage = new ChunkTestStorage();
    const app = testApp(storage);
    const sessionId = await initSession(app, CHUNK_BYTES * 2, 2);

    const aborted = await app(
      new Request(`${ORIGIN}/api/external-uploads/chunks/${sessionId}`, {
        method: "DELETE",
        headers: { Origin: ORIGIN }
      })
    );
    expect(aborted.status).toBe(204);

    const complete = await app(
      new Request(`${ORIGIN}/api/external-uploads/chunks/${sessionId}/complete`, {
        method: "POST",
        headers: { Origin: ORIGIN }
      })
    );
    expect(complete.status).toBe(404);
  });

  it("rejects cross-origin chunked uploads", async () => {
    const storage = new ChunkTestStorage();
    const app = testApp(storage);
    const response = await app(
      new Request(`${ORIGIN}/api/external-uploads/chunks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
        body: initBody(CHUNK_BYTES * 2, 2)
      })
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "invalid_origin" });
  });

  it("is unavailable when external uploads are disabled", async () => {
    const storage = new ChunkTestStorage();
    const app = testApp(storage, { externalUpload: false });
    const response = await app(
      new Request(`${ORIGIN}/api/external-uploads/chunks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN },
        body: initBody(CHUNK_BYTES * 2, 2)
      })
    );
    expect(response.status).toBe(503);
  });

  it("keeps chunk sizes within edge-proxy friendly bounds", () => {
    expect(CHUNKED_UPLOAD_MIN_CHUNK_BYTES).toBeGreaterThan(0);
    expect(CHUNKED_UPLOAD_MAX_CHUNK_BYTES).toBeLessThanOrEqual(100 * 1024 * 1024);
  });
});

describe("chunked native uploads", () => {
  it("reassembles bearer-authenticated chunks into one temporary file", async () => {
    const storage = new ChunkTestStorage();
    const app = testApp(storage);
    const totalBytes = CHUNK_BYTES * 2 + 17;
    const content = Buffer.alloc(totalBytes, 9);
    const sessionId = await initNativeSession(app, totalBytes, 3);

    for (let index = 0; index < 3; index += 1) {
      const start = index * CHUNK_BYTES;
      const end = Math.min(start + CHUNK_BYTES, totalBytes);
      const response = await app(
        new Request(`${ORIGIN}/api/uploads/chunks/${sessionId}/${index}`, {
          method: "PUT",
          headers: { Authorization: "Bearer upload-token" },
          body: content.subarray(start, end)
        })
      );
      expect(response.status).toBe(200);
    }

    const complete = await app(
      new Request(`${ORIGIN}/api/uploads/chunks/${sessionId}/complete`, {
        method: "POST",
        headers: { Authorization: "Bearer upload-token" }
      })
    );
    expect(complete.status).toBe(201);
    const payload = (await complete.json()) as { id: string; kind: string; bytes: number };
    expect(payload).toMatchObject({ kind: "file", bytes: totalBytes });
    expect(storage.files.get(payload.id)?.body.equals(content)).toBe(true);
  });

  it("requires the native bearer token on every chunk route", async () => {
    const storage = new ChunkTestStorage();
    const app = testApp(storage);
    const init = await app(
      new Request(`${ORIGIN}/api/uploads/chunks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: initBody(CHUNK_BYTES * 2, 2)
      })
    );
    expect(init.status).toBe(401);

    const sessionId = await initNativeSession(app, CHUNK_BYTES * 2, 2);
    const put = await app(
      new Request(`${ORIGIN}/api/uploads/chunks/${sessionId}/0`, {
        method: "PUT",
        body: Buffer.alloc(CHUNK_BYTES)
      })
    );
    expect(put.status).toBe(401);

    const complete = await app(
      new Request(`${ORIGIN}/api/uploads/chunks/${sessionId}/complete`, { method: "POST" })
    );
    expect(complete.status).toBe(401);

    const abort = await app(
      new Request(`${ORIGIN}/api/uploads/chunks/${sessionId}`, { method: "DELETE" })
    );
    expect(abort.status).toBe(401);
  });

  it("cannot use a browser chunk session through the native API", async () => {
    const storage = new ChunkTestStorage();
    const app = testApp(storage);
    const sessionId = await initSession(app, CHUNK_BYTES * 2, 2);
    const response = await app(
      new Request(`${ORIGIN}/api/uploads/chunks/${sessionId}/0`, {
        method: "PUT",
        headers: { Authorization: "Bearer upload-token" },
        body: Buffer.alloc(CHUNK_BYTES)
      })
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "upload_not_found" });
  });
});

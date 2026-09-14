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

const ORIGIN = "https://tools.example.test";
const CHUNK_BYTES = 1024 * 1024;

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

describe("chunked browser uploads", () => {
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

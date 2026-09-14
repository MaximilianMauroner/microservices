import { describe, expect, it } from "vitest";
import {
  CHUNKED_UPLOAD_CHUNK_BYTES,
  CHUNKED_UPLOAD_THRESHOLD_BYTES,
  UploadCancelledError,
  chunkPlan,
  chunkRange,
  friendlyUploadError,
  shouldUseChunkedUpload,
  uploadChunkedFile,
  type ChunkTransport
} from "../publisher/ui/chunked-upload.js";

function stubTransport(handlers: {
  init?: { status: number; payload: any };
  complete?: Array<{ status: number; payload: any }>;
  putStatus?: number;
}): ChunkTransport & { calls: { put: Array<{ url: string; size: number }>; deletes: string[] } } {
  const calls = { put: [] as Array<{ url: string; size: number }>, deletes: [] as string[] };
  let completeIndex = 0;
  return {
    calls,
    async postJson(url, _body) {
      if (url.endsWith("/complete")) {
        const step = handlers.complete?.[Math.min(completeIndex, (handlers.complete?.length ?? 1) - 1)] ?? {
          status: 201,
          payload: { url: "https://tools.example.test/files/id/file.bin" }
        };
        completeIndex += 1;
        return step;
      }
      return handlers.init ?? { status: 201, payload: { sessionId: "s".repeat(32) } };
    },
    async putBytes(url, bytes, onProgress) {
      calls.put.push({ url, size: bytes.size });
      onProgress(bytes.size, bytes.size);
      return { status: handlers.putStatus ?? 200, payload: {} };
    },
    async deleteSession(url) {
      calls.deletes.push(url);
    }
  };
}

describe("chunked upload client", () => {
  it("sends large files in chunks and small files in one request", () => {
    expect(shouldUseChunkedUpload(CHUNKED_UPLOAD_THRESHOLD_BYTES)).toBe(false);
    expect(shouldUseChunkedUpload(CHUNKED_UPLOAD_THRESHOLD_BYTES + 1)).toBe(true);
    expect(shouldUseChunkedUpload(250 * 1024 * 1024)).toBe(true);
  });

  it("plans 20 MB chunks for a 250 MB file", () => {
    const plan = chunkPlan(250 * 1024 * 1024);
    expect(plan.chunkBytes).toBe(CHUNKED_UPLOAD_CHUNK_BYTES);
    expect(plan.totalChunks).toBe(13);
    const last = chunkRange(250 * 1024 * 1024, plan.chunkBytes, 12);
    expect(last.expected).toBe(250 * 1024 * 1024 - 12 * plan.chunkBytes);
  });

  it("uploads every chunk then completes the session", async () => {
    const transport = stubTransport({});
    const file = new File([new Uint8Array(2_500_000).fill(9)], "big.bin", { type: "application/octet-stream" });
    const progress: Array<[number, number]> = [];
    const payload = await uploadChunkedFile(
      file,
      {
        onProgress: (loaded, total) => progress.push([loaded, total]),
        onProcessing: () => undefined,
        registerXhr: () => undefined,
        isCancelled: () => false
      },
      transport,
      { chunkBytes: 1024 * 1024 }
    );

    expect(payload.url).toContain("/files/");
    expect(transport.calls.put).toHaveLength(3);
    expect(transport.calls.put.map((call) => call.url)).toEqual([
      expect.stringContaining("/0"),
      expect.stringContaining("/1"),
      expect.stringContaining("/2")
    ]);
    expect(transport.calls.put[2]?.size).toBe(2_500_000 - 2 * 1024 * 1024);
    expect(progress.at(-1)).toEqual([2_500_000, 2_500_000]);
    expect(transport.calls.deletes).toHaveLength(0);
  });

  it("re-sends chunks the server reports missing", async () => {
    const transport = stubTransport({
      complete: [
        { status: 409, payload: { error: "incomplete_upload", message: "missing", missing: [1] } },
        { status: 201, payload: { url: "https://tools.example.test/files/id/file.bin" } }
      ]
    });
    const file = new File([new Uint8Array(2_500_000).fill(4)], "big.bin");
    await uploadChunkedFile(
      file,
      {
        onProgress: () => undefined,
        onProcessing: () => undefined,
        registerXhr: () => undefined,
        isCancelled: () => false
      },
      transport,
      { chunkBytes: 1024 * 1024 }
    );

    expect(transport.calls.put).toHaveLength(4);
    expect(transport.calls.put.filter((call) => call.url.endsWith("/1"))).toHaveLength(2);
  });

  it("aborts the session when cancelled", async () => {
    const transport = stubTransport({});
    const file = new File([new Uint8Array(2_500_000).fill(4)], "big.bin");
    const callbacks = {
      onProgress: () => undefined,
      onProcessing: () => undefined,
      registerXhr: () => undefined,
      isCancelled: () => true
    };
    await expect(uploadChunkedFile(file, callbacks, transport, { chunkBytes: 1024 * 1024 })).rejects.toBeInstanceOf(
      UploadCancelledError
    );
  });

  it("explains chunk failures with their position", async () => {
    const transport = stubTransport({ putStatus: 500 });
    const file = new File([new Uint8Array(2_500_000).fill(4)], "big.bin");
    await expect(
      uploadChunkedFile(
        file,
        {
          onProgress: () => undefined,
          onProcessing: () => undefined,
          registerXhr: () => undefined,
          isCancelled: () => false
        },
        transport,
        { chunkBytes: 1024 * 1024 }
      )
    ).rejects.toThrow("Chunk 1 of 3 failed");
    expect(transport.calls.deletes).toHaveLength(1);
  });

  it("maps edge and application failures to readable messages", () => {
    expect(friendlyUploadError(413, undefined)).toContain("size limit");
    expect(friendlyUploadError(401, undefined)).toContain("Sign in again");
    expect(friendlyUploadError(503, "The service is already processing its maximum number of uploads.")).toContain(
      "Wait a moment"
    );
    expect(friendlyUploadError(409, "Chunks 3 are still missing.")).toContain("Retry");
  });
});

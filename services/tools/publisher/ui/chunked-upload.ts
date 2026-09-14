import type { UploadSummary } from "../../src/protected-data.js";

// Single HTTP requests through the public edge proxy are capped well below the
// application limit (Cloudflare allows 100 MB on Free/Pro plans), so files
// above the threshold are split into small chunk requests and reassembled by
// the server. Chunk sizes stay within the server's accepted 1-64 MB window.
export const CHUNKED_UPLOAD_THRESHOLD_BYTES = 80 * 1024 * 1024;
export const CHUNKED_UPLOAD_CHUNK_BYTES = 20 * 1024 * 1024;

export class UploadCancelledError extends Error {
  constructor() {
    super("Upload cancelled.");
    this.name = "UploadCancelledError";
  }
}

export class ChunkTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChunkTransportError";
  }
}

export function friendlyUploadError(status: number, serverMessage?: string) {
  const base = serverMessage?.trim() ?? "";
  if (status === 401) {
    return base.toLowerCase().includes("session") && base
      ? base
      : "Your session expired. Sign in again, then retry.";
  }
  if (status === 403) return base || "Upload blocked. Open Publish from the app, then retry.";
  if (status === 413) return base || "The file exceeds the configured size limit.";
  if (status === 415) return base || "Unsupported upload type.";
  if (status === 409) return `${base || "The file changed during upload."} Retry.`;
  if (status === 503) {
    return base.toLowerCase().includes("maximum") && base
      ? `${base} Wait a moment, then retry.`
      : "The server is busy. Wait a moment, then retry.";
  }
  if (base) return base;
  if (status > 0) return `Upload failed (HTTP ${status}).`;
  return "The connection was interrupted. Check your network, then retry.";
}

export function parseErrorPayload(text: string): { message?: string } | undefined {
  try {
    const payload = JSON.parse(text) as { message?: unknown };
    return typeof payload.message === "string" ? { message: payload.message } : {};
  } catch {
    return undefined;
  }
}

export function shouldUseChunkedUpload(size: number) {
  return size > CHUNKED_UPLOAD_THRESHOLD_BYTES;
}

export function chunkPlan(totalBytes: number, chunkBytes: number = CHUNKED_UPLOAD_CHUNK_BYTES) {
  return { chunkBytes, totalChunks: Math.max(2, Math.ceil(totalBytes / chunkBytes)) };
}

export function chunkRange(totalBytes: number, chunkBytes: number, index: number) {
  const start = index * chunkBytes;
  const end = Math.min(start + chunkBytes, totalBytes);
  return { start, end, expected: end - start };
}

export type ChunkedUploadCallbacks = {
  onProgress: (loaded: number, total: number) => void;
  onProcessing: () => void;
  registerXhr: (xhr: XMLHttpRequest | null) => void;
  isCancelled: () => boolean;
};

export type ChunkTransport = {
  postJson: (url: string, body?: unknown) => Promise<{ status: number; payload: any }>;
  putBytes: (
    url: string,
    bytes: Blob,
    onProgress: (loaded: number, total: number) => void
  ) => Promise<{ status: number; payload: any }>;
  deleteSession: (url: string) => Promise<void>;
};

export function browserChunkTransport(registerXhr: (xhr: XMLHttpRequest | null) => void): ChunkTransport {
  return {
    async postJson(url, body) {
      const response = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      return { status: response.status, payload: await response.json().catch(() => undefined) };
    },
    putBytes(url, bytes, onProgress) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        registerXhr(xhr);
        xhr.upload.addEventListener("progress", (event) => {
          onProgress(event.loaded, event.lengthComputable ? event.total : bytes.size);
        });
        xhr.addEventListener("load", () => {
          registerXhr(null);
          resolve({ status: xhr.status, payload: parseErrorPayload(xhr.responseText) });
        });
        xhr.addEventListener("error", () => {
          registerXhr(null);
          reject(new ChunkTransportError("The connection was interrupted. Check your network, then retry."));
        });
        xhr.addEventListener("abort", () => {
          registerXhr(null);
          reject(new UploadCancelledError());
        });
        xhr.addEventListener("timeout", () => {
          registerXhr(null);
          reject(new ChunkTransportError("The upload timed out. Try again with a better connection."));
        });
        xhr.open("PUT", url);
        xhr.setRequestHeader("Accept", "application/json");
        xhr.withCredentials = true;
        xhr.send(bytes);
      });
    },
    async deleteSession(url) {
      try {
        await fetch(url, { method: "DELETE", credentials: "same-origin" });
      } catch {
        // Best effort: stale sessions expire on the server.
      }
    }
  };
}

function chunkFailure(index: number, totalChunks: number, error: unknown) {
  const reason = error instanceof Error ? error.message : "The upload failed.";
  return new Error(`Chunk ${index + 1} of ${totalChunks} failed: ${reason}`);
}

export async function uploadChunkedFile(
  file: File,
  callbacks: ChunkedUploadCallbacks,
  transport: ChunkTransport = browserChunkTransport(callbacks.registerXhr),
  options: { chunkBytes?: number } = {}
): Promise<UploadSummary> {
  const totalBytes = file.size;
  const chunkBytes = options.chunkBytes ?? CHUNKED_UPLOAD_CHUNK_BYTES;
  const { totalChunks } = chunkPlan(totalBytes, chunkBytes);
  let sessionId: string | undefined;
  const sessionBase = () => `/api/external-uploads/chunks/${sessionId}`;
  const abortSession = () => {
    if (sessionId) void transport.deleteSession(sessionBase());
  };

  async function sendChunk(index: number) {
    const { start, end } = chunkRange(totalBytes, chunkBytes, index);
    const blob = file.slice(start, end);
    let lastError: unknown;
    for (let attempt = 0; attempt <= 1; attempt += 1) {
      if (callbacks.isCancelled()) throw new UploadCancelledError();
      try {
        const result = await transport.putBytes(`${sessionBase()}/${index}`, blob, (loaded) =>
          callbacks.onProgress(Math.min(start + loaded, totalBytes), totalBytes)
        );
        if (result.status >= 200 && result.status < 300) return;
        throw new Error(friendlyUploadError(result.status, result.payload?.message));
      } catch (error) {
        if (error instanceof UploadCancelledError || callbacks.isCancelled()) {
          throw new UploadCancelledError();
        }
        lastError = error;
        if (!(error instanceof ChunkTransportError)) break;
      }
    }
    throw lastError;
  }

  try {
    if (callbacks.isCancelled()) throw new UploadCancelledError();
    const init = await transport.postJson("/api/external-uploads/chunks", {
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      totalBytes,
      totalChunks,
      chunkBytes
    });
    if (init.status < 200 || init.status >= 300 || typeof init.payload?.sessionId !== "string") {
      throw new Error(friendlyUploadError(init.status, init.payload?.message));
    }
    sessionId = init.payload.sessionId;

    for (let index = 0; index < totalChunks; index += 1) {
      if (callbacks.isCancelled()) throw new UploadCancelledError();
      try {
        await sendChunk(index);
      } catch (error) {
        throw chunkFailure(index, totalChunks, error);
      }
    }

    callbacks.onProcessing();
    const complete = await transport.postJson(`${sessionBase()}/complete`);
    if (complete.status === 409 && Array.isArray(complete.payload?.missing)) {
      for (const index of complete.payload.missing) {
        if (typeof index !== "number" || index < 0 || index >= totalChunks) continue;
        try {
          await sendChunk(index);
        } catch (error) {
          throw chunkFailure(index, totalChunks, error);
        }
      }
      const retry = await transport.postJson(`${sessionBase()}/complete`);
      if (retry.status >= 200 && retry.status < 300 && typeof retry.payload?.url === "string") {
        return retry.payload as UploadSummary;
      }
      throw new Error(friendlyUploadError(retry.status, retry.payload?.message));
    }
    if (complete.status >= 200 && complete.status < 300 && typeof complete.payload?.url === "string") {
      return complete.payload as UploadSummary;
    }
    throw new Error(friendlyUploadError(complete.status, complete.payload?.message));
  } catch (error) {
    abortSession();
    if (error instanceof UploadCancelledError || callbacks.isCancelled()) {
      throw new UploadCancelledError();
    }
    throw error;
  }
}

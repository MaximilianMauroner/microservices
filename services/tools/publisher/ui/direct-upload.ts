import type { UploadSummary } from "../../src/protected-data.js";
import { friendlyUploadError, UploadCancelledError } from "./upload-errors.js";

type Session = { sessionId: string; partBytes: number; totalParts: number; state: string; uploaded: number[] };
export type DirectUploadCallbacks = {
  onProgress: (loaded: number, total: number) => void;
  onProcessing: () => void;
  registerXhr: (xhr: XMLHttpRequest | null) => void;
  isCancelled: () => boolean;
};
type Options = { base?: string; kind?: "html" | "file"; project?: string };

/** Keep only a request ID in this tab. Reselecting the same file can resume;
 * storage is inspected again and each digest is checked against actual bytes. */
export async function uploadDirectFile(file: File, callbacks: DirectUploadCallbacks, options: Options = {}): Promise<UploadSummary> {
  const base = options.base ?? "/api/external-uploads/sessions";
  const fingerprint = JSON.stringify([base, file.name, file.size, file.lastModified, options.kind ?? "file", options.project ?? ""]);
  const savedKey = "publisher.direct-upload:" + fingerprint;
  let requestId = readSavedId(savedKey) ?? crypto.randomUUID();
  saveId(savedKey, requestId);
  const checkCancelled = () => { if (callbacks.isCancelled()) throw new UploadCancelledError(); };
  const control = async (url: string, body?: unknown, method = "POST") => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      checkCancelled();
      try {
        const response = await fetch(url, { method, credentials: "same-origin",
          signal: AbortSignal.timeout(20 * 60_000), headers: { Accept: "application/json",
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
        const payload: unknown = await response.json();
        if (response.ok) return payload;
        const error = errorPayload(payload);
        if (attempt < 3 && (response.status === 503 || error?.error === "upload_busy")) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
        throw new UploadControlError(response.status, friendlyUploadError(response.status, error?.message));
      } catch (error) {
        if (error instanceof UploadControlError || attempt === 3) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
    throw new Error("The upload could not be resumed.");
  };
  const initialize = () => control(base, { requestId, filename: file.name,
    contentType: file.type || "application/octet-stream", totalBytes: file.size,
    kind: options.kind ?? "file", ...(options.project?.trim() ? { project: options.project.trim() } : {}) });
  let session: Session;
  try {
    try { session = readSession(await initialize()); }
    catch (error) {
      if (!(error instanceof UploadControlError && error.status === 404)) throw error;
      requestId = crypto.randomUUID();
      saveId(savedKey, requestId);
      session = readSession(await initialize());
    }
    const sessionBase = `${base}/${session.sessionId}`;
    if (session.state === "uploading") {
      for (let number = 1; number <= session.totalParts; number += 1) {
        checkCancelled();
        const start = (number - 1) * session.partBytes;
        const end = Math.min(start + session.partBytes, file.size);
        const bytes = file.slice(start, end);
        const digest = await crypto.subtle.digest("SHA-256", await bytes.arrayBuffer());
        const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
        // Signing also checks the saved digest when reselecting a file. A part
        // found in storage is skipped only after that check succeeds.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const signed = await control(`${sessionBase}/parts`, { number, sha256 });
          if (!isRecord(signed) || typeof signed.url !== "string") throw new Error("Invalid upload response.");
          if (session.uploaded.includes(number)) break;
          try {
            await sendPart(signed.url, bytes, callbacks, loaded => callbacks.onProgress(start + loaded, file.size));
            break;
          } catch (error) {
            if (error instanceof UploadCancelledError || attempt === 1) throw error;
          }
        }
        callbacks.onProgress(end, file.size);
      }
    }
    checkCancelled();
    callbacks.onProcessing();
    const completed = await control(`${sessionBase}/complete`);
    if (!isUploadSummary(completed)) throw new Error("Invalid upload completion response.");
    removeSavedId(savedKey);
    return completed;
  } catch (error) {
    if (callbacks.isCancelled() || error instanceof UploadCancelledError) {
      void fetch(`${base}/${requestId}`, { method: "DELETE", credentials: "same-origin" }).catch(() => {});
      removeSavedId(savedKey);
      throw new UploadCancelledError();
    }
    // Leave the durable session available after interruption. Retry uses the
    // same request ID and skips parts the bucket has already accepted.
    throw error;
  }
}

function sendPart(url: string, bytes: Blob, callbacks: DirectUploadCallbacks, progress: (bytes: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    callbacks.registerXhr(xhr);
    xhr.upload.addEventListener("progress", event => progress(event.loaded));
    xhr.addEventListener("loadend", () => callbacks.registerXhr(null));
    xhr.addEventListener("load", () => xhr.status >= 200 && xhr.status < 300
      ? resolve() : reject(new Error("The file transfer was interrupted. Retry to resume.")));
    xhr.addEventListener("error", () => reject(new Error("The connection was interrupted. Retry to resume.")));
    xhr.addEventListener("abort", () => reject(new UploadCancelledError()));
    xhr.addEventListener("timeout", () => reject(new Error("The upload timed out. Retry to resume.")));
    xhr.open("PUT", url);
    xhr.timeout = 5 * 60_000;
    // Only the signed capability travels cross-origin. Browser cookies and the
    // native upload credential must never be sent to the bucket.
    xhr.withCredentials = false;
    xhr.send(bytes);
  });
}

class UploadControlError extends Error { constructor(readonly status: number, message: string) { super(message); } }
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function errorPayload(value: unknown) {
  if (!isRecord(value)) return undefined;
  return { error: typeof value.error === "string" ? value.error : undefined,
    message: typeof value.message === "string" ? value.message : undefined };
}
function readSession(value: unknown): Session {
  if (!isRecord(value) || typeof value.sessionId !== "string" || typeof value.partBytes !== "number"
    || value.partBytes < 1 || value.partBytes > 64 * 1024 * 1024 || typeof value.totalParts !== "number"
    || value.totalParts < 1 || value.totalParts > 250 || typeof value.state !== "string" || !Array.isArray(value.uploaded)
    || !value.uploaded.every(number => typeof number === "number")) throw new Error("Invalid upload session response.");
  return { sessionId: value.sessionId, partBytes: value.partBytes, totalParts: value.totalParts,
    state: value.state, uploaded: value.uploaded };
}
function isUploadSummary(value: unknown): value is UploadSummary {
  return isRecord(value) && typeof value.id === "string" && typeof value.url === "string"
    && typeof value.filename === "string" && typeof value.bytes === "number"
    && (value.kind === "html" || value.kind === "file") && typeof value.contentType === "string";
}
function readSavedId(key: string) { try { return sessionStorage.getItem(key) ?? undefined; } catch { return undefined; } }
function saveId(key: string, id: string) { try { sessionStorage.setItem(key, id); } catch { /* This upload still survives web restarts. */ } }
function removeSavedId(key: string) { try { sessionStorage.removeItem(key); } catch { /* Storage can be disabled. */ } }

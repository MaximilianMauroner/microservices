import type { UploadSummary } from "../../src/protected-data.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { friendlyUploadError, UploadCancelledError } from "./upload-errors.js";

type Session = { sessionId: string; partBytes: number; totalParts: number; state: string; uploaded: number[]; replaceId?: string };
export type DirectUploadCallbacks = {
  onProgress: (loaded: number, total: number) => void;
  onProcessing: () => void;
  registerXhr: (xhr: XMLHttpRequest | null) => void;
  isCancelled: () => boolean;
  signal?: AbortSignal;
};
type Options = { base?: string; kind?: "html" | "file"; project?: string; replaceId?: string };

/** Keep only a request ID in this tab. Reselecting the same file can resume;
 * storage is inspected again and each digest is checked against actual bytes. */
export async function uploadDirectFile(file: File, callbacks: DirectUploadCallbacks, options: Options = {}): Promise<UploadSummary> {
  const base = options.base ?? "/api/external-uploads/sessions";
  const fingerprint = JSON.stringify([base, file.name, file.size, file.lastModified, options.kind ?? "file", options.project ?? "", options.replaceId ?? ""]);
  const savedKey = "publisher.direct-upload:" + fingerprint;
  let requestId = readSavedId(savedKey) ?? crypto.randomUUID();
  saveId(savedKey, requestId);
  const checkCancelled = () => { if (callbacks.signal?.aborted || callbacks.isCancelled()) throw new UploadCancelledError(); };
  const control = async (url: string, body?: unknown, method = "POST") => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      checkCancelled();
      try {
        const response = await fetch(url, { method, credentials: "same-origin",
          signal: callbacks.signal ? AbortSignal.any([callbacks.signal, AbortSignal.timeout(20 * 60_000)]) : AbortSignal.timeout(20 * 60_000), headers: { Accept: "application/json",
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
        checkCancelled();
        const payload: unknown = await response.json();
        checkCancelled();
        if (response.ok) return payload;
        const error = errorPayload(payload);
        if (attempt < 3 && (response.status === 503 || error?.error === "upload_busy")) {
          await waitForRetry(1000 * (attempt + 1), callbacks.signal);
          continue;
        }
        throw new UploadControlError(response.status, friendlyUploadError(response.status, error?.message));
      } catch (error) {
        checkCancelled();
        if (error instanceof UploadControlError || attempt === 3) throw error;
        await waitForRetry(1000 * (attempt + 1), callbacks.signal);
      }
    }
    throw new Error("The upload could not be resumed.");
  };
  const initialize = () => control(base, { requestId, filename: file.name,
    contentType: file.type || "application/octet-stream", totalBytes: file.size,
    kind: options.kind ?? "file", ...(options.project?.trim() ? { project: options.project.trim() } : {}),
    ...(options.replaceId ? { replaceId: options.replaceId } : {}) });
  let session: Session;
  try {
    try { session = readSession(await initialize()); }
    catch (error) {
      if (options.replaceId || !(error instanceof UploadControlError && error.status === 404)) throw error;
      requestId = crypto.randomUUID();
      saveId(savedKey, requestId);
      session = readSession(await initialize());
    }
    if (options.replaceId && session.replaceId !== options.replaceId) throw new Error("The server does not support this HTML replacement.");
    const sessionBase = `${base}/${session.sessionId}`;
    if (session.state === "uploading") {
      for (let number = 1; number <= session.totalParts; number += 1) {
        checkCancelled();
        const start = (number - 1) * session.partBytes;
        const end = Math.min(start + session.partBytes, file.size);
        const bytes = file.slice(start, end);
        const buffer = await bytes.arrayBuffer();
        checkCancelled();
        const digest = await crypto.subtle.digest("SHA-256", buffer);
        checkCancelled();
        const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
        // Signing also checks the saved digest when reselecting a file. A part
        // found in storage is skipped only after that check succeeds.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const signed = await control(`${sessionBase}/parts`, { number, sha256 });
          checkCancelled();
          if (!isRecord(signed) || typeof signed.url !== "string") throw new Error("Invalid upload response.");
          if (session.uploaded.includes(number)) break;
          try {
            await sendPart(signed.url, bytes, callbacks, loaded => callbacks.onProgress(start + loaded, file.size));
            checkCancelled();
            break;
          } catch (error) {
            checkCancelled();
            if (error instanceof UploadCancelledError || attempt === 1) throw error;
          }
        }
        callbacks.onProgress(end, file.size);
      }
    }
    checkCancelled();
    callbacks.onProcessing();
    const expectedSha256 = await hashFile(file, checkCancelled);
    const completed = await control(`${sessionBase}/complete`, { sha256: expectedSha256 });
    checkCancelled();
    if (!isUploadSummary(completed)) throw new Error("Invalid upload completion response.");
    if (options.replaceId && completed.id !== options.replaceId) throw new Error("The server did not replace the selected HTML page.");
    if (completed.sha256 !== expectedSha256 || completed.bytes !== file.size) {
      throw new Error("The published file does not match the selected file. Keep the original source to resume.");
    }
    removeSavedId(savedKey);
    return completed;
  } catch (error) {
    if (callbacks.signal?.aborted || callbacks.isCancelled() || error instanceof UploadCancelledError) {
      void fetch(`${base}/${requestId}`, { method: "DELETE", credentials: "same-origin", signal: AbortSignal.timeout(5000) }).catch(() => {});
      removeSavedId(savedKey);
      throw new UploadCancelledError();
    }
    // Leave the durable session available after interruption. Retry uses the
    // same request ID and skips parts the bucket has already accepted.
    throw error;
  }
}

async function hashFile(file: File, checkCancelled: () => void) {
  const hash = sha256.create();
  const reader = file.stream().getReader();
  try {
    for (;;) {
      checkCancelled();
      const { value, done } = await reader.read();
      if (done) break;
      hash.update(value);
    }
    return Array.from(hash.digest(), byte => byte.toString(16).padStart(2, "0")).join("");
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

function sendPart(url: string, bytes: Blob, callbacks: DirectUploadCallbacks, progress: (bytes: number) => void) {
  return new Promise<void>((resolve, reject) => {
    if (callbacks.signal?.aborted || callbacks.isCancelled()) { reject(new UploadCancelledError()); return; }
    const xhr = new XMLHttpRequest();
    callbacks.registerXhr(xhr);
    const abort = () => xhr.abort();
    callbacks.signal?.addEventListener("abort", abort, { once: true });
    xhr.upload.addEventListener("progress", event => progress(event.loaded));
    xhr.addEventListener("loadend", () => {
      callbacks.signal?.removeEventListener("abort", abort);
      callbacks.registerXhr(null);
    });
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

function waitForRetry(milliseconds: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(new UploadCancelledError());
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, milliseconds);
    const abort = () => { clearTimeout(timer); reject(new UploadCancelledError()); };
    signal?.addEventListener("abort", abort, { once: true });
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
    state: value.state, uploaded: value.uploaded,
    ...(typeof value.replaceId === "string" ? { replaceId: value.replaceId } : {}) };
}
function isUploadSummary(value: unknown): value is UploadSummary & { sha256: string } {
  return isRecord(value) && typeof value.id === "string" && typeof value.url === "string"
    && typeof value.filename === "string" && typeof value.bytes === "number"
    && (value.kind === "html" || value.kind === "file") && typeof value.contentType === "string" && typeof value.sha256 === "string";
}
function readSavedId(key: string) { try { return sessionStorage.getItem(key) ?? undefined; } catch { return undefined; } }
function saveId(key: string, id: string) { try { sessionStorage.setItem(key, id); } catch { /* This upload still survives web restarts. */ } }
function removeSavedId(key: string) { try { sessionStorage.removeItem(key); } catch { /* Storage can be disabled. */ } }

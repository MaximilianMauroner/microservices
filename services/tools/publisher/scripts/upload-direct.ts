import crypto from "node:crypto";
import { open, stat } from "node:fs/promises";
import type { BigIntStats } from "node:fs";
import path from "node:path";

class ApiError extends Error {}

const [filePath, resumeId] = process.argv.slice(2);
if (!filePath) throw new Error("Usage: pnpm upload:direct <file> [request-id]");
const origin = process.env.PUBLIC_BASE_URL;
const token = process.env.UPLOAD_TOKEN;
if (!origin || !token) throw new Error("PUBLIC_BASE_URL and UPLOAD_TOKEN are required.");
const base = new URL("/api/uploads/sessions", origin).href;
const requestId = resumeId ?? crypto.randomUUID();
// This ID is safe to retain; every session operation still requires the bearer.
console.error(`Upload request ID: ${requestId}`);
const file = await open(filePath, "r");
try {
  const source = await file.stat({ bigint: true });
  const size = Number(source.size);
  const sourceSha256 = await hashSource();
  await checkSource(source);
  const filename = path.basename(filePath);
  const html = /\.html?$/i.test(filename);
  const contentType = html ? "text/html" : /\.mp4$/i.test(filename) ? "video/mp4" : "application/octet-stream";
  const initialized = await control(base, { requestId, filename, contentType, totalBytes: size, kind: html ? "html" : "file" });
  if (!record(initialized) || typeof initialized.sessionId !== "string" || typeof initialized.partBytes !== "number"
    || initialized.partBytes < 1 || initialized.partBytes > 64 * 1024 * 1024 || typeof initialized.totalParts !== "number"
    || initialized.totalParts < 1 || initialized.totalParts > 250 || !Array.isArray(initialized.uploaded)) throw new Error("Invalid upload session.");
  const sessionBase = `${base}/${initialized.sessionId}`;
  if (initialized.state === "uploading") {
    for (let number = 1; number <= initialized.totalParts; number += 1) {
      const offset = (number - 1) * initialized.partBytes;
      const bytes = Buffer.alloc(Math.min(initialized.partBytes, size - offset));
      let received = 0;
      while (received < bytes.length) {
        const result = await file.read(bytes, received, bytes.length - received, offset + received);
        if (result.bytesRead === 0) throw new Error("The file changed during upload.");
        received += result.bytesRead;
      }
      const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const signed = await control(`${sessionBase}/parts`, { number, sha256 });
        if (!record(signed) || typeof signed.url !== "string") throw new Error("Invalid upload part URL.");
        if (initialized.uploaded.includes(number)) break;
        try {
          const response = await fetch(signed.url, { method: "PUT", body: bytes, credentials: "omit",
            signal: AbortSignal.timeout(5 * 60_000) });
          if (!response.ok) throw new Error(`Storage rejected part ${number} (${response.status}).`);
          break;
        } catch (error) { if (attempt === 1) throw error; }
      }
    }
  }
  if (await hashSource() !== sourceSha256) throw new Error("The file changed during upload.");
  await checkSource(source);
  const completed = await control(`${sessionBase}/complete`, { sha256: sourceSha256 });
  if (!record(completed) || completed.bytes !== size || completed.sha256 !== sourceSha256) {
    throw new Error("The published file does not match the source. Retain the request ID for recovery.");
  }
  console.log(JSON.stringify(completed));
} finally { await file.close(); }

async function hashSource() {
  const hash = crypto.createHash("sha256");
  for await (const bytes of file.createReadStream({ start: 0, autoClose: false })) hash.update(bytes);
  return hash.digest("hex");
}

async function checkSource(expected: BigIntStats) {
  for (const actual of [await file.stat({ bigint: true }), await stat(filePath!, { bigint: true })]) {
    if (actual.dev !== expected.dev || actual.ino !== expected.ino || actual.size !== expected.size
      || actual.mtimeNs !== expected.mtimeNs || actual.ctimeNs !== expected.ctimeNs) {
      throw new Error("The file changed during upload.");
    }
  }
}

async function control(url: string, body?: unknown): Promise<unknown> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, { method: "POST", signal: AbortSignal.timeout(20 * 60_000),
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      const payload: unknown = await response.json();
      if (response.ok) return payload;
      if (attempt < 3 && (response.status === 503 || (record(payload) && payload.error === "upload_busy"))) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }
      throw new ApiError(record(payload) && typeof payload.message === "string" ? payload.message : `Upload rejected (${response.status}).`);
    } catch (error) {
      if (error instanceof ApiError || attempt === 3) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw new Error("Upload control request failed.");
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }

import { DIRECT_PART_BYTES, type DirectUploadOwner, type DirectUploads, type DirectUploadIntent } from "./direct-uploads.js";
import { DirectUploadError, type DirectUploadDescription } from "./multipart-storage.js";
import { artifactUrls, normalizeMimeType, normalizeProjectName, safeFileName } from "./file-metadata.js";
import type { UploadLink } from "./upload-links.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function handleDirectUpload(request: Request, remainder: string, uploads: DirectUploads,
  owner: DirectUploadOwner, options: { maxBytes: number; maxHtmlBytes: number; maxConcurrent: number;
    retentionMs: number; baseUrl: string; allowHtml: boolean; link?: UploadLink }) {
  const controlSignal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
  if (request.method === "POST" && remainder === "") {
    const input = await readJson(request, controlSignal);
    if (typeof input.requestId !== "string" || !UUID.test(input.requestId)) throw invalid("A UUID requestId is required.");
    if (typeof input.filename !== "string" || !input.filename.trim() || Buffer.byteLength(input.filename) > 255) throw invalid("Filename is invalid.");
    if (typeof input.contentType !== "string" || input.contentType.length > 255) throw invalid("Content type is invalid.");
    if (typeof input.totalBytes !== "number" || !Number.isSafeInteger(input.totalBytes) || input.totalBytes < 0) throw invalid("File size is invalid.");
    const kind = input.kind ?? "file";
    if (kind !== "file" && kind !== "html") throw invalid("Upload kind is invalid.");
    const contentType = normalizeMimeType(input.contentType);
    if (kind === "html" && (!options.allowHtml || !/\.html?$/i.test(input.filename)
      || !["text/html", "application/xhtml+xml"].includes(contentType))) throw invalid("This route cannot publish that HTML file.");
    if (input.totalBytes > (kind === "html" ? options.maxHtmlBytes : options.maxBytes)) {
      throw new DirectUploadError(413, "payload_too_large", "The file exceeds the configured size limit.");
    }
    const project = typeof input.project === "string" ? normalizeProjectName(input.project) : undefined;
    if (input.project !== undefined && (kind !== "html" || !project)) throw invalid("Project name is invalid.");
    let intent: DirectUploadIntent = { kind: "create" };
    if (input.replaceId !== undefined) {
      if (kind !== "html" || owner.audience === "drop" || typeof input.replaceId !== "string"
        || !/^[A-Za-z0-9_-]{32}$/.test(input.replaceId)) throw invalid("Replacement requires an existing HTML ID.");
      intent = { kind: "replace", targetId: input.replaceId };
    }
    const description: DirectUploadDescription = {
      kind, filename: safeFileName(input.filename, "download"),
      contentType: kind === "html" ? "text/html; charset=utf-8" : contentType,
      totalBytes: input.totalBytes, partBytes: DIRECT_PART_BYTES,
      ...(project ? { project } : {}),
      ...(kind === "file" ? { retentionMs: options.retentionMs, fileExpiresAt: new Date(Math.max(Date.now() + options.retentionMs,
        options.link?.expiresAt.getTime() ?? 0)).toISOString() } : {})
    };
    await uploads.cleanup(controlSignal);
    return json(await uploads.create(input.requestId, owner, description,
      Math.max(16, options.maxConcurrent * 4), controlSignal, intent), 201);
  }
  const [id, action, extra] = remainder.split("/");
  if (!id || !UUID.test(id) || extra !== undefined) throw new DirectUploadError(404, "not_found", "Upload route was not found.");
  if (request.method === "GET" && action === undefined) return json(await uploads.status(id, owner, controlSignal));
  if (request.method === "DELETE" && action === undefined) {
    await uploads.abort(id, owner, controlSignal);
    return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
  }
  if (request.method === "POST" && action === "parts") {
    const input = await readJson(request, controlSignal);
    if (typeof input.number !== "number" || typeof input.sha256 !== "string") throw invalid("A part number and SHA-256 are required.");
    return json(await uploads.sign(id, owner, input.number, input.sha256, controlSignal));
  }
  if (request.method === "POST" && action === "complete") {
    const completed = await uploads.complete(id, owner, options.maxConcurrent, request.signal);
    const { totalBytes, fileExpiresAt, partBytes: _partBytes, retentionMs: _retentionMs, ...metadata } = completed;
    return json({ ...metadata, bytes: totalBytes,
      ...artifactUrls(options.baseUrl, completed),
      ...(fileExpiresAt ? { expiresAt: fileExpiresAt } : {}) }, 201);
  }
  throw new DirectUploadError(404, "not_found", "Upload route was not found.");
}

function invalid(message: string) { return new DirectUploadError(400, "invalid_upload", message); }
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" } });
}

async function readJson(request: Request, signal: AbortSignal): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") throw invalid("Expected application/json.");
  const reader = request.body?.getReader();
  if (!reader) throw invalid("Upload description is missing.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const cancel = () => { void reader.cancel(signal.reason); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4096) throw invalid("Upload description is too large.");
      chunks.push(value);
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid("Expected a JSON object.");
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SyntaxError) throw invalid("Upload description is invalid JSON.");
    throw error;
  } finally { signal.removeEventListener("abort", cancel); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

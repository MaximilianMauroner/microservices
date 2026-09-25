import crypto from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { ZipWriter } from "@zip.js/zip.js";
import busboy from "busboy";
import { ActivityTracker } from "./activity-tracker.js";
import {
  EXTERNAL_UPLOAD_SCRIPT,
  EXTERNAL_UPLOAD_STYLES,
  renderExternalUploadPage
} from "./external-upload-page.js";
import { renderDropUploadPage } from "./drop-upload-page.js";
import {
  MAX_UPLOAD_LINK_DURATION_MS,
  MIN_UPLOAD_LINK_DURATION_MS,
  UPLOAD_LINK_TOKEN_PATTERN,
  type UploadLink,
  type UploadLinkRepository
} from "./upload-links.js";
import {
  attachmentDisposition,
  MAX_FILE_NAME_BYTES,
  MAX_PROJECT_NAME_BYTES,
  normalizeMimeType,
  normalizeProjectName,
  safeFileName
} from "./file-metadata.js";
import {
  FileUpdateConflictError,
  HtmlUpdateConflictError,
  RangeNotSatisfiableError,
  UploadLinkInactiveError,
  type ListUploadsOptions,
  type UploadExpiryFilter,
  type UploadListCursor,
  type UploadListSort,
  type UploadStorage
} from "./storage.js";

export const MAX_SINGLE_PUT_UPLOAD_BYTES = 5_000_000_000;
export const DEFAULT_MAX_UPLOAD_BYTES = MAX_SINGLE_PUT_UPLOAD_BYTES;
export const DEFAULT_MAX_HTML_UPLOAD_BYTES = 25_000_000;
// Single HTTP requests through the public edge proxy are capped well below the
// application limit (Cloudflare allows 100 MB on Free/Pro plans), so large
// browser uploads are split into small chunk requests and reassembled here.
export const CHUNKED_UPLOAD_MAX_CHUNKS = 250;
export const CHUNKED_UPLOAD_MIN_CHUNK_BYTES = 1024 * 1024;
export const CHUNKED_UPLOAD_MAX_CHUNK_BYTES = 64 * 1024 * 1024;
const CHUNKED_UPLOAD_SESSION_PREFIX = "artifact-chunks-";
const CHUNKED_UPLOAD_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const CHUNKED_UPLOAD_INIT_MAX_BYTES = 4096;
const MAX_INCOMPLETE_DROP_SESSIONS_PER_LINK = 3;
const MAX_PENDING_DROP_CHUNK_INITS = 16;
const MAX_CONCURRENT_DROP_CHUNK_WRITES = 8;
export const DEFAULT_MAX_CONCURRENT_UPLOADS = 1;
export const DEFAULT_TEMPORARY_FILE_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;
export const MAX_TEMPORARY_FILE_RETENTION_MS = 100 * 365 * 24 * 60 * 60 * 1000;
export const DEFAULT_GUEST_UPLOAD_BODY_TIMEOUT_MS = 5 * 60 * 1000;

const PAGE_ID_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HTML_MIME_TYPES = new Set(["text/html", "application/xhtml+xml"]);
const HTML_EXTENSIONS = new Set([".html", ".htm"]);
const HTML_CONTENT_TYPE = "text/html; charset=utf-8";
const DEFAULT_PUBLISHER_FAVICON_URL = "/assets/icons/publisher.png";
const HTML_HEAD_BUFFER_LIMIT = 256 * 1024;
const SINGLE_BYTE_RANGE_PATTERN = /^bytes=(?:\d+-\d*|-\d+)$/i;
const DEFAULT_UPLOAD_LIST_LIMIT = 25;
const MAX_UPLOAD_LIST_LIMIT = 100;
const MAX_UPLOAD_LIST_CURSOR_LENGTH = 2048;
const UPLOAD_LINK_PAGE_SIZE = 20;
const UPLOAD_KEY_PATTERN =
  /^(?:pages\/[A-Za-z0-9_-]{32}\.html|files\/[A-Za-z0-9_-]{32})$/;
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#f3f1e9"/>
  <path d="M16 6.5 24 11v10l-8 4.5L8 21V11l8-4.5Z" fill="none" stroke="#087451" stroke-width="3" stroke-linejoin="round"/>
  <circle cx="16" cy="6.5" r="3.4" fill="#f3f1e9" stroke="#087451" stroke-width="2.6"/>
  <circle cx="8" cy="21" r="3.4" fill="#f3f1e9" stroke="#087451" stroke-width="2.6"/>
  <circle cx="24" cy="21" r="3.4" fill="#f3f1e9" stroke="#087451" stroke-width="2.6"/>
  <circle cx="16" cy="6.5" r="1.25" fill="#18211c"/>
  <circle cx="8" cy="21" r="1.25" fill="#18211c"/>
  <circle cx="24" cy="21" r="1.25" fill="#18211c"/>
  <path d="m16 13.5 2 1.2v2.6l-2 1.2-2-1.2v-2.6l2-1.2Z" fill="#18211c"/>
</svg>`;
const PUBLIC_HTML_CSP =
  "sandbox allow-scripts allow-forms allow-modals allow-popups allow-downloads";
const EXTERNAL_UPLOAD_CSP = [
  "default-src 'none'",
  "connect-src 'self'",
  "img-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");
const EXTERNAL_UPLOAD_ASSET_VERSION = crypto
  .createHash("sha256")
  .update(EXTERNAL_UPLOAD_STYLES)
  .update("\0")
  .update(EXTERNAL_UPLOAD_SCRIPT)
  .digest("hex")
  .slice(0, 16);

export type FetchArtifactAppOptions = {
  activityTracker?: ActivityTracker;
  storage: UploadStorage;
  uploadToken: string;
  externalUpload?: boolean;
  uploadLinks?: UploadLinkRepository;
  publicBaseUrl?: string;
  publisherFaviconUrl?: string;
  maxUploadBytes?: number;
  maxHtmlUploadBytes?: number;
  maxConcurrentUploads?: number;
  temporaryFileRetentionMs?: number;
  guestUploadBodyTimeoutMs?: number;
  now?: () => Date;
};

export function createFetchApp(options: FetchArtifactAppOptions) {
  const activityTracker = options.activityTracker ?? new ActivityTracker();
  const maxUploadBytes = positiveIntegerOption(
    options.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES,
    "maxUploadBytes"
  );
  const maxHtmlUploadBytes = positiveIntegerOption(
    options.maxHtmlUploadBytes ?? Math.min(DEFAULT_MAX_HTML_UPLOAD_BYTES, maxUploadBytes),
    "maxHtmlUploadBytes"
  );
  const maxConcurrentUploads = positiveIntegerOption(
    options.maxConcurrentUploads ?? DEFAULT_MAX_CONCURRENT_UPLOADS,
    "maxConcurrentUploads"
  );
  const temporaryFileRetentionMs = positiveIntegerOption(
    options.temporaryFileRetentionMs ?? DEFAULT_TEMPORARY_FILE_RETENTION_MS,
    "temporaryFileRetentionMs"
  );
  const guestUploadBodyTimeoutMs = positiveIntegerOption(
    options.guestUploadBodyTimeoutMs ?? DEFAULT_GUEST_UPLOAD_BODY_TIMEOUT_MS,
    "guestUploadBodyTimeoutMs"
  );
  const publisherFaviconUrl = options.publisherFaviconUrl ?? DEFAULT_PUBLISHER_FAVICON_URL;
  const publisherFavicon = publisherFaviconLink(publisherFaviconUrl);
  if (maxHtmlUploadBytes > maxUploadBytes) {
    throw new Error("maxHtmlUploadBytes must be less than or equal to maxUploadBytes");
  }
  if (temporaryFileRetentionMs > MAX_TEMPORARY_FILE_RETENTION_MS) {
    throw new Error(
      `temporaryFileRetentionMs must be less than or equal to ${MAX_TEMPORARY_FILE_RETENTION_MS}`
    );
  }

  const uploadGate = createUploadGate(maxConcurrentUploads);
  const dropChunkInitGate = createDropChunkInitGate(
    MAX_INCOMPLETE_DROP_SESSIONS_PER_LINK,
    MAX_PENDING_DROP_CHUNK_INITS
  );
  const dropChunkWriteGate = createUploadGate(MAX_CONCURRENT_DROP_CHUNK_WRITES);
  const uploadToken = requireUploadToken(options.uploadToken);

  return async function artifactFetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      const dropToken = matchDropPage(url.pathname);
      if ((request.method === "GET" || request.method === "HEAD") && dropToken) {
        const link = await options.uploadLinks?.findActive(dropToken, getNow(options));
        if (!link) return dropLinkNotFound();
        const nonce = crypto.randomBytes(18).toString("base64");
        return withDropUploadHeaders(new Response(
          request.method === "HEAD" ? null : renderDropUploadPage(
            link.expiresAt,
            nonce,
            publisherFaviconUrl
          ),
          { headers: { "Cache-Control": "private, no-store", "Content-Type": "text/html; charset=utf-8" } }
        ), nonce);
      }

      if (request.method === "GET" && url.pathname === "/api/upload-links") {
        requireUploadLinks(options);
        const before = parseUploadLinkCursor(singleQuery(url.searchParams, "cursor"));
        const batch = await options.uploadLinks!.list({
          limit: UPLOAD_LINK_PAGE_SIZE + 1,
          ...(before ? { before } : {})
        });
        const links = batch.slice(0, UPLOAD_LINK_PAGE_SIZE);
        const nextCursor = batch.length > UPLOAD_LINK_PAGE_SIZE
          ? encodeUploadLinkCursor(links.at(-1)!)
          : undefined;
        return jsonResponse(
          {
            links: links.map(serializeUploadLink),
            ...(nextCursor ? { nextCursor } : {})
          },
          200,
          { "Cache-Control": "private, no-store" }
        );
      }

      const uploadLinkDownload = /^\/api\/upload-links\/([^/]+)\/download$/.exec(url.pathname)?.[1];
      if (request.method === "GET" && uploadLinkDownload) {
        requireUploadLinks(options);
        if (!UUID_PATTERN.test(uploadLinkDownload)) {
          throw new ArtifactRequestError(400, "invalid_upload_link_id", "Upload link ID is invalid.");
        }
        const files = await options.uploadLinks!.listFiles(uploadLinkDownload, getNow(options));
        if (!files) throw new ArtifactRequestError(404, "upload_link_not_found", "Upload link was not found.");
        return downloadUploadLinkFiles(
          files,
          options.storage,
          uploadLinkDownload,
          request.signal,
          activityTracker
        );
      }

      if (request.method === "POST" && url.pathname === "/api/upload-links") {
        requireSameOrigin(request, url, options.publicBaseUrl);
        requireUploadLinks(options);
        const durationMs = await readUploadLinkDuration(request, url);
        const created = await options.uploadLinks!.create(
          new Date(getNow(options).getTime() + durationMs)
        );
        const baseUrl = getPublicBaseUrl(request, options.publicBaseUrl);
        return jsonResponse({ ...serializeUploadLink(created), url: `${baseUrl}/drop/${created.token}` }, 201);
      }

      const uploadLinkId = matchPath(url.pathname, "/api/upload-links/");
      if (request.method === "DELETE" && uploadLinkId !== undefined) {
        requireSameOrigin(request, url, options.publicBaseUrl);
        requireUploadLinks(options);
        if (!UUID_PATTERN.test(uploadLinkId)) {
          throw new ArtifactRequestError(400, "invalid_upload_link_id", "Upload link ID is invalid.");
        }
        const revoked = await options.uploadLinks!.revoke(uploadLinkId, getNow(options));
        if (!revoked) {
          throw new ArtifactRequestError(404, "upload_link_not_found", "Upload link was not found.");
        }
        return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
      }

      const dropUploadToken = matchDropUpload(url.pathname);
      if (request.method === "POST" && dropUploadToken) {
        requireSameOrigin(request, url, options.publicBaseUrl);
        requireMultipartUpload(request);
        const link = await options.uploadLinks?.findActive(dropUploadToken, getNow(options));
        if (!link) return dropLinkUnavailable();
        return upload(
          request,
          url,
          options,
          {
            kind: "create",
            temporaryOnly: true,
            uploadLinkId: link.id,
            expiresAt: link.expiresAt,
            ensureActive: async () => Boolean(
              await options.uploadLinks?.findActive(dropUploadToken, getNow(options))
            )
          },
          uploadGate,
          maxUploadBytes,
          maxHtmlUploadBytes,
          temporaryFileRetentionMs,
          activityTracker,
          guestUploadBodyTimeoutMs
        );
      }

      const dropChunk = matchDropChunk(url.pathname);
      if (dropChunk) {
        requireSameOrigin(request, url, options.publicBaseUrl);
        const chunkSession = matchChunkSession(dropChunk.remainder);
        if (request.method === "DELETE" && chunkSession) {
          const link = await options.uploadLinks?.find(dropChunk.token);
          if (!link) return dropLinkUnavailable();
          return await abortChunkedUpload(chunkSession, "drop", link.id);
        }
        const link = await options.uploadLinks?.findActive(dropChunk.token, getNow(options));
        if (!link) return dropLinkUnavailable();
        if (request.method === "POST" && dropChunk.remainder === "") {
          const guestBodySignal = AbortSignal.any([
            request.signal,
            AbortSignal.timeout(guestUploadBodyTimeoutMs)
          ]);
          let plan: ChunkedUploadPlan;
          try {
            plan = await readChunkedUploadPlan(request, maxUploadBytes, guestBodySignal);
          } catch (error) {
            if (!request.signal.aborted && guestBodySignal.aborted) {
              throw new ArtifactRequestError(
                408,
                "upload_timeout",
                "The guest upload body was not received before the upload deadline."
              );
            }
            throw error;
          }
          return await dropChunkInitGate.run(link.id, request.signal, () =>
            initChunkedUpload(plan, "drop", link.id)
          );
        }
        const chunkPut = matchChunkPut(dropChunk.remainder);
        if (request.method === "PUT" && chunkPut) {
          const release = dropChunkWriteGate.tryAcquire();
          if (!release) {
            await consumeBody(request);
            return jsonResponse({
              error: "upload_capacity_reached",
              message: "Too many guest chunks are being written. Try again shortly."
            }, 503, { Connection: "close", "Retry-After": "1" });
          }
          const guestBodySignal = AbortSignal.any([
            request.signal,
            AbortSignal.timeout(guestUploadBodyTimeoutMs)
          ]);
          try {
            return await putUploadChunk(
              request,
              chunkPut.sessionId,
              chunkPut.index,
              "drop",
              link.id,
              guestBodySignal
            );
          } catch (error) {
            if (!request.signal.aborted && guestBodySignal.aborted) {
              throw new ArtifactRequestError(
                408,
                "upload_timeout",
                "The guest upload body was not received before the upload deadline."
              );
            }
            throw error;
          } finally {
            release();
          }
        }
        const chunkComplete = matchChunkComplete(dropChunk.remainder);
        if (request.method === "POST" && chunkComplete) {
          return await completeChunkedUpload(
            request, url, options, chunkComplete, uploadGate, maxUploadBytes,
            temporaryFileRetentionMs, activityTracker, "drop", link,
            async () => Boolean(
              await options.uploadLinks?.findActive(dropChunk.token, getNow(options))
            )
          );
        }
        throw new ArtifactRequestError(404, "not_found", "API route was not found.");
      }

      if (request.method === "GET" || request.method === "HEAD") {
        const page = await readPageRoute(
          request,
          url,
          options,
          temporaryFileRetentionMs,
          publisherFavicon
        );
        if (page) return page;
        const file = await readFileRoute(request, url, options);
        if (file) return file;
      }

      if (request.method === "GET" && isExternalUploadPagePath(url.pathname)) {
        if (!options.externalUpload) return externalUploadUnavailable();
        return withExternalUploadHeaders(
          new Response(
            renderExternalUploadPage({
              assetVersion: EXTERNAL_UPLOAD_ASSET_VERSION,
              retentionLabel: formatRetention(temporaryFileRetentionMs)
            }),
            {
              headers: {
                "Cache-Control": "private, no-store",
                "Content-Type": "text/html; charset=utf-8"
              }
            }
          )
        );
      }

      if (request.method === "GET" && isExternalUploadAssetPath(url.pathname)) {
        if (!options.externalUpload) return externalUploadUnavailable();
        const asset = url.pathname.endsWith(".css")
          ? EXTERNAL_UPLOAD_STYLES
          : EXTERNAL_UPLOAD_SCRIPT;
        const contentType = url.pathname.endsWith(".css")
          ? "text/css; charset=utf-8"
          : "text/javascript; charset=utf-8";
        return withExternalUploadHeaders(
          new Response(asset, {
            headers: {
              "Cache-Control": url.pathname.includes("/assets/")
                ? "private, max-age=31536000, immutable"
                : "private, no-store",
              "Content-Type": contentType
            }
          })
        );
      }

      if (request.method === "GET" && url.pathname === "/api/external-uploads") {
        if (!options.externalUpload) return externalUploadUnavailable();
        return tracked(
          activityTracker,
          () => listExternalUploads(request, url, options),
          request.signal
        );
      }

      if (request.method === "POST" && url.pathname === "/api/external-uploads") {
        if (!options.externalUpload) return externalUploadUnavailable();
        requireSameOrigin(request, url, options.publicBaseUrl);
        requireMultipartUpload(request);
        return upload(
          request,
          url,
          options,
          { kind: "create", temporaryOnly: true },
          uploadGate,
          maxUploadBytes,
          maxHtmlUploadBytes,
          temporaryFileRetentionMs,
          activityTracker
        );
      }

      if (request.method === "POST" && url.pathname === "/api/external-uploads/chunks") {
        if (!options.externalUpload) return externalUploadUnavailable();
        requireSameOrigin(request, url, options.publicBaseUrl);
        // Awaited so handler rejections reach the shared error mapper below.
        const plan = await readChunkedUploadPlan(request, maxUploadBytes, request.signal);
        return await initChunkedUpload(plan, "browser");
      }

      const chunkRemainder = matchPath(url.pathname, "/api/external-uploads/chunks/");
      if (chunkRemainder !== undefined) {
        if (!options.externalUpload) return externalUploadUnavailable();
        requireSameOrigin(request, url, options.publicBaseUrl);
        const chunkPut = matchChunkPut(chunkRemainder);
        if (request.method === "PUT" && chunkPut) {
          return await putUploadChunk(request, chunkPut.sessionId, chunkPut.index, "browser");
        }
        const chunkComplete = matchChunkComplete(chunkRemainder);
        if (request.method === "POST" && chunkComplete) {
          return await completeChunkedUpload(
            request,
            url,
            options,
            chunkComplete,
            uploadGate,
            maxUploadBytes,
            temporaryFileRetentionMs,
            activityTracker,
            "browser"
          );
        }
        const chunkSession = matchChunkSession(chunkRemainder);
        if (request.method === "DELETE" && chunkSession) {
          return await abortChunkedUpload(chunkSession, "browser");
        }
        throw new ArtifactRequestError(
          404,
          "not_found",
          "API route was not found."
        );
      }

      const externalUploadId = matchPath(url.pathname, "/api/external-uploads/");
      if (externalUploadId !== undefined && ["PUT", "PATCH", "DELETE"].includes(request.method)) {
        if (!options.externalUpload) return externalUploadUnavailable();
        requireSameOrigin(request, url, options.publicBaseUrl);
        if (!PAGE_ID_PATTERN.test(externalUploadId)) {
          throw new ArtifactRequestError(
            400,
            "invalid_upload_id",
            "Upload ID is invalid."
          );
        }
        if (request.method === "PUT") {
          requireMultipartUpload(request);
          return upload(
            request,
            url,
            options,
            { kind: "update", id: externalUploadId },
            uploadGate,
            maxUploadBytes,
            maxHtmlUploadBytes,
            temporaryFileRetentionMs,
            activityTracker
          );
        }
        if (request.method === "PATCH") {
          const update = await readUploadUpdate(request, getNow(options));
          if (update.kind === "expiry") {
            try {
              const updated = await options.storage.updateFileExpiry(
                externalUploadId,
                update.expiresAt,
                { signal: request.signal }
              );
              if (!updated) {
                throw new ArtifactRequestError(
                  404,
                  "upload_not_found",
                  "The file upload was not found."
                );
              }
            } catch (error) {
              if (error instanceof FileUpdateConflictError) {
                throw new ArtifactRequestError(
                  409,
                  "upload_conflict",
                  "The file changed or was revoked before the expiry update completed."
                );
              }
              throw error;
            }
            return jsonResponse({
              id: externalUploadId,
              expiresAt: update.expiresAt?.toISOString() ?? null
            });
          }
          const { project } = update;
          try {
            const updated = await options.storage.updateHtmlProject(
              externalUploadId,
              project,
              { signal: request.signal }
            );
            if (!updated) {
              throw new ArtifactRequestError(
                404,
                "upload_not_found",
                "The HTML upload was not found."
              );
            }
          } catch (error) {
            if (error instanceof HtmlUpdateConflictError) {
              throw new ArtifactRequestError(
                409,
                "upload_conflict",
                "The HTML page changed or was revoked before the project update completed."
              );
            }
            throw error;
          }
          return jsonResponse({ id: externalUploadId, project });
        }
        await options.storage.deleteUpload(externalUploadId, { signal: request.signal });
        return new Response(null, { status: 204 });
      }

      if (url.pathname === "/api/uploads" && request.method === "POST") {
        requireBearer(request, uploadToken);
        requireMultipartUpload(request);
        return upload(
          request,
          url,
          options,
          { kind: "create" },
          uploadGate,
          maxUploadBytes,
          maxHtmlUploadBytes,
          temporaryFileRetentionMs,
          activityTracker
        );
      }

      if (request.method === "POST" && url.pathname === "/api/uploads/chunks") {
        requireBearer(request, uploadToken);
        const plan = await readChunkedUploadPlan(request, maxUploadBytes, request.signal);
        return await initChunkedUpload(plan, "native");
      }

      const nativeChunkRemainder = matchPath(url.pathname, "/api/uploads/chunks/");
      if (nativeChunkRemainder !== undefined) {
        requireBearer(request, uploadToken);
        const chunkPut = matchChunkPut(nativeChunkRemainder);
        if (request.method === "PUT" && chunkPut) {
          return await putUploadChunk(request, chunkPut.sessionId, chunkPut.index, "native");
        }
        const chunkComplete = matchChunkComplete(nativeChunkRemainder);
        if (request.method === "POST" && chunkComplete) {
          return await completeChunkedUpload(
            request,
            url,
            options,
            chunkComplete,
            uploadGate,
            maxUploadBytes,
            temporaryFileRetentionMs,
            activityTracker,
            "native"
          );
        }
        const chunkSession = matchChunkSession(nativeChunkRemainder);
        if (request.method === "DELETE" && chunkSession) {
          return await abortChunkedUpload(chunkSession, "native");
        }
        throw new ArtifactRequestError(
          404,
          "not_found",
          "API route was not found."
        );
      }

      const uploadId = matchPath(url.pathname, "/api/uploads/");
      if (uploadId !== undefined && request.method === "PATCH") {
        requireBearer(request, uploadToken);
        if (!PAGE_ID_PATTERN.test(uploadId)) {
          throw new ArtifactRequestError(400, "invalid_upload_id", "Upload ID is invalid.");
        }
        const update = await readUploadUpdate(request, getNow(options));
        if (update.kind !== "expiry") {
          throw new ArtifactRequestError(400, "invalid_upload_update", "Native uploads can only change file expiry.");
        }
        try {
          const updated = await options.storage.updateFileExpiry(uploadId, update.expiresAt, { signal: request.signal });
          if (!updated) {
            throw new ArtifactRequestError(404, "upload_not_found", "The file upload was not found.");
          }
        } catch (error) {
          if (error instanceof FileUpdateConflictError) {
            throw new ArtifactRequestError(409, "upload_conflict", "The file changed or was revoked before the expiry update completed.");
          }
          throw error;
        }
        return jsonResponse({ id: uploadId, expiresAt: update.expiresAt?.toISOString() ?? null });
      }
      if (uploadId !== undefined && request.method === "PUT") {
        requireBearer(request, uploadToken);
        if (!PAGE_ID_PATTERN.test(uploadId)) {
          throw new ArtifactRequestError(
            400,
            "invalid_upload_id",
            "Upload ID is invalid."
          );
        }
        requireMultipartUpload(request);
        return upload(
          request,
          url,
          options,
          { kind: "update", id: uploadId },
          uploadGate,
          maxUploadBytes,
          maxHtmlUploadBytes,
          temporaryFileRetentionMs,
          activityTracker
        );
      }
      if (uploadId !== undefined && request.method === "DELETE") {
        requireBearer(request, uploadToken);
        if (!PAGE_ID_PATTERN.test(uploadId)) {
          throw new ArtifactRequestError(
            400,
            "invalid_upload_id",
            "Upload ID is invalid."
          );
        }
        await options.storage.deleteUpload(uploadId, { signal: request.signal });
        return new Response(null, { status: 204 });
      }

      if (url.pathname.startsWith("/api/")) {
        return jsonResponse(
          { error: "not_found", message: "API route was not found." },
          404
        );
      }
      return new Response("Route not found.", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    } catch (error) {
      if (isRequestAbort(error, request.signal)) {
        throw error;
      }
      return artifactErrorResponse(error);
    }
  };
}

function isRequestAbort(error: unknown, signal: AbortSignal) {
  if (!signal.aborted) return false;
  if (error === signal.reason) return true;
  return error instanceof Error && error.name === "AbortError";
}

async function readPageRoute(
  request: Request,
  url: URL,
  options: FetchArtifactAppOptions,
  _temporaryFileRetentionMs: number,
  publisherFavicon: Buffer
): Promise<Response | undefined> {
  if (url.pathname === "/favicon.svg" || url.pathname === "/favicon.ico") {
    return new Response(FAVICON_SVG, {
      headers: {
        "Cache-Control": "public, max-age=86400",
        "Content-Type": "image/svg+xml; charset=utf-8"
      }
    });
  }

  const match = matchCapabilityPath(url.pathname, ["/artifacts/", "/p/"]);
  if (match === undefined) return undefined;
  if (!PAGE_ID_PATTERN.test(match)) return new Response(null, { status: 404 });

  const html = await options.storage.getHtml(match, {
    headOnly: request.method === "HEAD",
    signal: request.signal
  });
  if (!html) return new Response(null, { status: 404 });

  const headers = new Headers({
    "Cache-Control": "private, no-cache",
    "Content-Security-Policy": PUBLIC_HTML_CSP,
    "Content-Type": "text/html; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow"
  });
  applyRepresentationHeaders(
    headers,
    html.bytes + publisherFavicon.length,
    htmlRepresentationSha256(html.sha256, publisherFavicon),
    html.lastModified
  );
  if (isNotModified(request, headers)) {
    html.body.destroy();
    return new Response(null, { status: 304, headers });
  }
  if (request.method === "HEAD") {
    html.body.destroy();
    return new Response(null, { status: 200, headers });
  }
  return new Response(
    toWebStream(html.body.compose(new PublisherFaviconTransform(publisherFavicon))),
    { headers }
  );
}

async function readFileRoute(
  request: Request,
  url: URL,
  options: FetchArtifactAppOptions
): Promise<Response | undefined> {
  const match = matchFilePath(url.pathname);
  if (!match) return undefined;
  const { id } = match;
  if (!PAGE_ID_PATTERN.test(id)) return new Response(null, { status: 404 });

  let range = request.method === "HEAD" ? undefined : requestedRange(request);
  if (range === null) {
    const metadata = await options.storage.getTemporaryFile(id, {
      headOnly: true,
      signal: request.signal
    });
    if (!metadata || isExpired(metadata.expiresAt, getNow(options))) {
      metadata?.body.destroy();
      return new Response(null, { status: 404 });
    }
    metadata.body.destroy();
    return rangeNotSatisfiable(metadata.bytes);
  }

  const ifRange = range ? request.headers.get("if-range") : undefined;
  if (range && ifRange) {
    const metadata = await options.storage.getTemporaryFile(id, {
      headOnly: true,
      signal: request.signal
    });
    if (!metadata || isExpired(metadata.expiresAt, getNow(options))) {
      metadata?.body.destroy();
      return new Response(null, { status: 404 });
    }
    metadata.body.destroy();
    if (!ifRangeAllowsPartialResponse(ifRange, metadata.sha256, metadata.lastModified)) {
      range = undefined;
    }
  }

  try {
    const file = await options.storage.getTemporaryFile(id, {
      headOnly: request.method === "HEAD",
      range,
      signal: request.signal
    });
    if (!file || isExpired(file.expiresAt, getNow(options))) {
      file?.body.destroy();
      return new Response(null, { status: 404 });
    }

    const headers = new Headers({
      "Accept-Ranges": "bytes",
      // Artifact pages run sandboxed, so they reach this file across origins.
      // The URL is already the capability, and no credentials travel with it.
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "private, no-store",
      "Content-Disposition": attachmentDisposition(file.originalName),
      "Content-Type": normalizeMimeType(file.contentType),
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow"
    });
    applyRepresentationHeaders(headers, file.bytes, file.sha256, file.lastModified);
    if (file.contentRange) {
      headers.set("Content-Range", file.contentRange);
    }
    const status = file.contentRange ? 206 : 200;
    if (request.method === "HEAD") {
      file.body.destroy();
      return new Response(null, { status, headers });
    }
    return new Response(toWebStream(file.body), { status, headers });
  } catch (error) {
    if (error instanceof RangeNotSatisfiableError) {
      if (isExpired(error.expiresAt, getNow(options))) {
        return new Response(null, { status: 404 });
      }
      return rangeNotSatisfiable(error.totalBytes);
    }
    throw error;
  }
}

async function listExternalUploads(
  request: Request,
  url: URL,
  options: FetchArtifactAppOptions
): Promise<Response> {
  const pagination = parseUploadListOptions(url.searchParams);
  const baseUrl = getPublicBaseUrl(request, options.publicBaseUrl);
  const page = await options.storage.listUploads(getNow(options), {
    ...pagination,
    signal: request.signal
  });
  return jsonResponse(
    {
      uploads: page.uploads.map((upload) => ({
        id: upload.id,
        kind: upload.kind,
        filename: upload.originalName,
        contentType: upload.contentType,
        url:
          upload.kind === "html"
            ? `${baseUrl}/artifacts/${upload.id}`
            : `${baseUrl}/files/${upload.id}/${encodeURIComponent(upload.originalName)}`,
        bytes: upload.bytes,
        updatedAt: upload.updatedAt.toISOString(),
        ...(upload.project ? { project: upload.project } : {}),
        ...(upload.expiresAt ? { expiresAt: upload.expiresAt.toISOString() } : {})
      })),
      ...(page.summary ? { summary: page.summary } : {}),
      ...(page.nextCursor
        ? {
            nextCursor: encodeUploadListCursor(
              page.nextCursor,
              pagination.criteria ?? "legacy:newest",
              page.uploads.at(-1)?.originalName ?? page.nextCursor.key
            )
          }
        : {})
    },
    200,
    { "Cache-Control": "private, no-store" }
  );
}

async function upload(
  request: Request,
  url: URL,
  options: FetchArtifactAppOptions,
  mode: UploadMode,
  gate: ReturnType<typeof createUploadGate>,
  maxUploadBytes: number,
  maxHtmlUploadBytes: number,
  temporaryFileRetentionMs: number,
  activityTracker: ActivityTracker,
  guestUploadBodyTimeoutMs?: number
): Promise<Response> {
  const release = gate.tryAcquire();
  if (!release) {
    await consumeBody(request);
    return jsonResponse(
      {
        error: "upload_capacity_reached",
        message: "The service is already processing its maximum number of uploads."
      },
      503,
      { Connection: "close", "Retry-After": "1" }
    );
  }

  return activityTracker.track(
    (async () => {
      let staged: StagedUpload | undefined;
      let cleanupId: string | undefined;
      let responseSent = false;
      try {
        const guestBodySignal = guestUploadBodyTimeoutMs === undefined
          ? request.signal
          : AbortSignal.any([request.signal, AbortSignal.timeout(guestUploadBodyTimeoutMs)]);
        try {
          staged = await stageMultipart(request, {
            maxUploadBytes,
            maxHtmlUploadBytes,
            temporaryOnly: mode.kind === "create" && mode.temporaryOnly === true,
            signal: guestBodySignal
          });
        } catch (error) {
          if (!request.signal.aborted && guestBodySignal.aborted) {
            throw new ArtifactRequestError(
              408,
              "upload_timeout",
              "The guest upload body was not received before the upload deadline."
            );
          }
          throw error;
        }
        const uploadType = classifyUpload(
          staged.originalName,
          staged.contentType,
          mode.kind === "create" && mode.temporaryOnly === true
        );
        if (mode.kind === "update" && uploadType.kind !== "html") {
          throw new ArtifactRequestError(
            400,
            "html_upload_required",
            "Only HTML pages can be updated."
          );
        }
        const id = mode.kind === "update" ? mode.id : generatePageId();
        const originalName = safeFileName(
          staged.originalName,
          uploadType.kind === "temporary" ? "download" : "page.html"
        );
        const baseUrl = getPublicBaseUrl(request, options.publicBaseUrl);
        let project = staged.project;
        let updateEtag: string | undefined;
        if (mode.kind === "update") {
          const existing = await options.storage.getHtml(id, {
            headOnly: true,
            signal: request.signal
          });
          if (!existing) {
            throw new ArtifactRequestError(
              404,
              "upload_not_found",
              "The HTML upload to update was not found."
            );
          }
          existing.body.destroy();
          project ??= existing.project;
          if (!existing.etag) throw new Error(`Stored HTML ${id} is missing an ETag`);
          updateEtag = existing.etag;
        }

        const sha256 = await sha256File(staged.filePath, request.signal);
        throwIfAborted(request.signal);
        if (uploadType.kind === "html") {
          if (mode.kind === "create") cleanupId = id;
          try {
            await options.storage.putHtml(
              id,
              staged.filePath,
              {
                bytes: staged.bytes,
                originalName,
                sha256,
                ...(project ? { project } : {})
              },
              { ifMatch: updateEtag, signal: request.signal }
            );
          } catch (error) {
            if (error instanceof HtmlUpdateConflictError) {
              throw new ArtifactRequestError(
                409,
                "upload_conflict",
                "The HTML page changed or was revoked before the update completed."
              );
            }
            throw error;
          }
          throwIfAborted(request.signal);
          responseSent = true;
          return jsonResponse(
            {
              id,
              kind: "html",
              filename: originalName,
              contentType: HTML_CONTENT_TYPE,
              url: `${baseUrl}/artifacts/${id}`,
              bytes: staged.bytes,
              sha256,
              ...(project ? { project } : {})
            },
            mode.kind === "create" ? 201 : 200
          );
        }

        const expiresAt = mode.kind === "create" && mode.expiresAt
          ? new Date(Math.max(mode.expiresAt.getTime(), getNow(options).getTime() + temporaryFileRetentionMs))
          : new Date(getNow(options).getTime() + temporaryFileRetentionMs);
        cleanupId = id;
        if (mode.kind === "create" && mode.ensureActive && !(await mode.ensureActive())) {
          throw new ArtifactRequestError(
            404,
            "upload_link_unavailable",
            "This upload link has expired or was revoked."
          );
        }
        await options.storage.putTemporaryFile(
          id,
          staged.filePath,
          {
            bytes: staged.bytes,
            contentType: uploadType.contentType,
            expiresAt,
            originalName,
            sha256,
            ...(mode.kind === "create" && mode.uploadLinkId ? { uploadLinkId: mode.uploadLinkId } : {})
          },
          { signal: request.signal }
        );
        throwIfAborted(request.signal);
        responseSent = true;
        return jsonResponse(
          {
            id,
            kind: "file",
            filename: originalName,
            contentType: uploadType.contentType,
            url: `${baseUrl}/files/${id}/${encodeURIComponent(originalName)}`,
            bytes: staged.bytes,
            expiresAt: expiresAt.toISOString(),
            sha256
          },
          201
        );
      } catch (error) {
        if (cleanupId && !responseSent) {
          try {
            await options.storage.deleteUpload(cleanupId, { signal: request.signal });
          } catch (cleanupError) {
            console.error("failed to clean up an interrupted upload", cleanupError);
          }
        }
        throw error;
      } finally {
        release();
        if (staged) await safeUnlink(staged.filePath);
      }
    })()
  ).then(
    (response) => response,
    (error) => artifactErrorResponse(error)
  );
}

type ChunkSessionManifest = {
  version: 1;
  audience: "browser" | "native" | "drop";
  uploadLinkId?: string;
  originalName: string;
  contentType: string;
  totalBytes: number;
  totalChunks: number;
  chunkBytes: number;
  createdAt: string;
};

type ChunkedUploadPlan = Pick<
  ChunkSessionManifest,
  "originalName" | "contentType" | "totalBytes" | "totalChunks" | "chunkBytes"
>;

function matchChunkPut(remainder: string): { sessionId: string; index: number } | undefined {
  const match = /^([A-Za-z0-9_-]{32})\/(\d+)$/.exec(remainder);
  if (!match) return undefined;
  const index = Number(match[2]);
  if (!Number.isSafeInteger(index)) return undefined;
  return { sessionId: match[1]!, index };
}

function matchChunkComplete(remainder: string): string | undefined {
  const match = /^([A-Za-z0-9_-]{32})\/complete$/.exec(remainder);
  return match?.[1];
}

function matchChunkSession(remainder: string): string | undefined {
  const match = /^([A-Za-z0-9_-]{32})$/.exec(remainder);
  return match?.[1];
}

function chunkSessionDir(sessionId: string) {
  return path.join(os.tmpdir(), `${CHUNKED_UPLOAD_SESSION_PREFIX}${sessionId}`);
}

function chunkPartPath(sessionId: string, index: number) {
  return path.join(chunkSessionDir(sessionId), `${index}.part`);
}

function expectedChunkBytes(manifest: ChunkSessionManifest, index: number) {
  return index < manifest.totalChunks - 1
    ? manifest.chunkBytes
    : manifest.totalBytes - (manifest.totalChunks - 1) * manifest.chunkBytes;
}

async function readChunkManifest(sessionId: string): Promise<ChunkSessionManifest | null> {
  let raw: string;
  try {
    raw = await readFile(path.join(chunkSessionDir(sessionId), "manifest.json"), "utf8");
  } catch {
    return null;
  }
  try {
    const manifest = JSON.parse(raw) as ChunkSessionManifest;
    if (
      manifest?.version !== 1 ||
      !["browser", "native", "drop"].includes(manifest.audience) ||
      (manifest.audience === "drop" && (typeof manifest.uploadLinkId !== "string" || !UUID_PATTERN.test(manifest.uploadLinkId))) ||
      typeof manifest.originalName !== "string" ||
      typeof manifest.contentType !== "string" ||
      !Number.isSafeInteger(manifest.totalBytes) ||
      !Number.isSafeInteger(manifest.totalChunks) ||
      !Number.isSafeInteger(manifest.chunkBytes) ||
      typeof manifest.createdAt !== "string" ||
      Number.isNaN(Date.parse(manifest.createdAt))
    ) return null;
    if (Date.now() - Date.parse(manifest.createdAt) > CHUNKED_UPLOAD_SESSION_TTL_MS) {
      await removeChunkSession(sessionId);
      return null;
    }
    return manifest;
  } catch {
    return null;
  }
}

async function removeChunkSession(sessionId: string) {
  try {
    await rm(chunkSessionDir(sessionId), { recursive: true, force: true });
  } catch (error) {
    console.error("failed to clean up a chunked upload session", error);
  }
}

async function sweepStaleChunkSessions() {
  try {
    const entries = await readdir(os.tmpdir());
    for (const entry of entries) {
      if (!entry.startsWith(CHUNKED_UPLOAD_SESSION_PREFIX)) continue;
      const sessionId = entry.slice(CHUNKED_UPLOAD_SESSION_PREFIX.length);
      if (!PAGE_ID_PATTERN.test(sessionId)) continue;
      const manifest = await readChunkManifest(sessionId);
      if (manifest === null) {
        // readChunkManifest already removes expired sessions; anything else is
        // left alone so a concurrent init is never deleted mid-write.
      }
    }
  } catch (error) {
    console.error("failed to sweep stale chunked upload sessions", error);
  }
}

async function countDropChunkSessions(uploadLinkId: string) {
  let count = 0;
  const entries = await readdir(os.tmpdir());
  for (const entry of entries) {
    if (!entry.startsWith(CHUNKED_UPLOAD_SESSION_PREFIX)) continue;
    const sessionId = entry.slice(CHUNKED_UPLOAD_SESSION_PREFIX.length);
    if (!PAGE_ID_PATTERN.test(sessionId)) continue;
    const manifest = await readChunkManifest(sessionId);
    if (manifest?.audience === "drop" && manifest.uploadLinkId === uploadLinkId) count += 1;
  }
  return count;
}

function createDropChunkInitGate(maxSessionsPerLink: number, maxPending: number) {
  type PendingInitialization = {
    signal: AbortSignal;
    abort: () => void;
    reject: (reason: unknown) => void;
    execute: () => Promise<void>;
  };
  const pending: PendingInitialization[] = [];
  let running = false;

  const startNext = () => {
    if (running) return;
    const job = pending.shift();
    if (!job) return;
    job.signal.removeEventListener("abort", job.abort);
    if (job.signal.aborted) {
      job.reject(job.signal.reason ?? new DOMException("Request aborted", "AbortError"));
      queueMicrotask(startNext);
      return;
    }
    running = true;
    void job.execute().finally(() => {
      running = false;
      startNext();
    });
  };

  return {
    run<T>(uploadLinkId: string, signal: AbortSignal, initialize: () => Promise<T>): Promise<T> {
      if (signal.aborted) return Promise.reject(signal.reason);
      if (pending.length >= maxPending) {
        return Promise.reject(new ArtifactRequestError(
          429,
          "upload_initialization_busy",
          "Too many upload initializations are waiting. Try again shortly.",
          { "Retry-After": "1" }
        ));
      }
      return new Promise<T>((resolve, reject) => {
        const job: PendingInitialization = {
          signal,
          reject,
          abort: () => {
            const index = pending.indexOf(job);
            if (index < 0) return;
            pending.splice(index, 1);
            signal.removeEventListener("abort", job.abort);
            reject(signal.reason ?? new DOMException("Request aborted", "AbortError"));
          },
          execute: async () => {
            try {
              await sweepStaleChunkSessions();
              if (await countDropChunkSessions(uploadLinkId) >= maxSessionsPerLink) {
                throw new ArtifactRequestError(
                  429,
                  "too_many_incomplete_uploads",
                  "Finish or cancel an incomplete upload before starting another.",
                  { "Retry-After": "60" }
                );
              }
              resolve(await initialize());
            } catch (error) {
              reject(error);
            }
          }
        };
        signal.addEventListener("abort", job.abort, { once: true });
        pending.push(job);
        startNext();
      });
    }
  };
}

async function readLimitedBody(request: Request, maxBytes: number, signal: AbortSignal) {
  if (!request.body) return "";
  if (signal.aborted) throw signal.reason;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const abort = () => { void reader.cancel(signal.reason).catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw signal.reason;
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new ArtifactRequestError(
          413,
          "payload_too_large",
          "Chunked upload description is too large."
        );
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

async function readChunkedUploadPlan(
  request: Request,
  maxUploadBytes: number,
  signal: AbortSignal
): Promise<ChunkedUploadPlan> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new ArtifactRequestError(
      415,
      "unsupported_media_type",
      "Expected application/json."
    );
  }
  const raw = await readLimitedBody(request, CHUNKED_UPLOAD_INIT_MAX_BYTES, signal);
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new ArtifactRequestError(400, "invalid_chunked_upload", "Chunked upload description is invalid JSON.");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ArtifactRequestError(400, "invalid_chunked_upload", "Chunked upload description must be an object.");
  }
  const { filename, contentType, totalBytes, totalChunks, chunkBytes } = input as Record<string, unknown>;
  if (typeof filename !== "string" || filename.trim().length === 0 || Buffer.byteLength(filename, "utf8") > 255) {
    throw new ArtifactRequestError(400, "invalid_filename", "Filename must be 1 to 255 characters.");
  }
  if (typeof contentType !== "string" || contentType.length === 0 || contentType.length > 255) {
    throw new ArtifactRequestError(400, "invalid_content_type", "Content type must be 1 to 255 characters.");
  }
  if (!Number.isSafeInteger(totalBytes) || (totalBytes as number) < 1) {
    throw new ArtifactRequestError(400, "invalid_total_bytes", "totalBytes must be a positive integer.");
  }
  if ((totalBytes as number) > maxUploadBytes) {
    throw new ArtifactRequestError(
      413,
      "payload_too_large",
      "The uploaded file exceeds the configured size limit."
    );
  }
  if (!Number.isSafeInteger(totalChunks) || (totalChunks as number) < 2 || (totalChunks as number) > CHUNKED_UPLOAD_MAX_CHUNKS) {
    throw new ArtifactRequestError(
      400,
      "invalid_chunk_plan",
      `totalChunks must be an integer between 2 and ${CHUNKED_UPLOAD_MAX_CHUNKS}.`
    );
  }
  if (
    !Number.isSafeInteger(chunkBytes) ||
    (chunkBytes as number) < CHUNKED_UPLOAD_MIN_CHUNK_BYTES ||
    (chunkBytes as number) > CHUNKED_UPLOAD_MAX_CHUNK_BYTES
  ) {
    throw new ArtifactRequestError(
      400,
      "invalid_chunk_plan",
      `chunkBytes must be between ${CHUNKED_UPLOAD_MIN_CHUNK_BYTES} and ${CHUNKED_UPLOAD_MAX_CHUNK_BYTES}.`
    );
  }
  const total = totalBytes as number;
  const chunks = totalChunks as number;
  const nominal = chunkBytes as number;
  if ((chunks - 1) * nominal >= total || total > chunks * nominal) {
    throw new ArtifactRequestError(400, "invalid_chunk_plan", "Chunk plan does not cover the total file size.");
  }

  return {
    originalName: filename,
    contentType: normalizeMimeType(contentType),
    totalBytes: total,
    totalChunks: chunks,
    chunkBytes: nominal
  };
}

async function initChunkedUpload(
  plan: ChunkedUploadPlan,
  audience: ChunkSessionManifest["audience"],
  uploadLinkId?: string
): Promise<Response> {
  const {
    originalName,
    contentType,
    totalBytes: total,
    totalChunks: chunks,
    chunkBytes: nominal
  } = plan;

  const manifest: ChunkSessionManifest = {
    version: 1,
    audience,
    ...(uploadLinkId ? { uploadLinkId } : {}),
    originalName,
    contentType,
    totalBytes: total,
    totalChunks: chunks,
    chunkBytes: nominal,
    createdAt: new Date().toISOString()
  };
  let sessionId = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    sessionId = generatePageId();
    try {
      await mkdir(chunkSessionDir(sessionId), { recursive: false });
      break;
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
      sessionId = "";
    }
  }
  if (!sessionId) throw new Error("Could not allocate a chunked upload session");
  await writeFile(path.join(chunkSessionDir(sessionId), "manifest.json"), JSON.stringify(manifest), "utf8");
  await sweepStaleChunkSessions();
  return jsonResponse(
    {
      sessionId,
      chunkBytes: nominal,
      totalChunks: chunks,
      totalBytes: total,
      expiresAt: new Date(Date.now() + CHUNKED_UPLOAD_SESSION_TTL_MS).toISOString()
    },
    201
  );
}

class ChunkLimitTransform extends Transform {
  received = 0;

  constructor(private readonly expected: number, private readonly index: number) {
    super();
  }

  override _transform(
    chunk: unknown,
    encoding: BufferEncoding,
    callback: TransformCallback
  ) {
    const buffer = typeof chunk === "string"
      ? Buffer.from(chunk, encoding)
      : chunk instanceof Uint8Array
        ? Buffer.from(chunk)
        : undefined;
    if (!buffer) {
      callback(new TypeError("Chunk stream emitted a non-byte chunk"));
      return;
    }
    if (this.received + buffer.length > this.expected) {
      callback(
        new ArtifactRequestError(
          400,
          "invalid_chunk",
          `Chunk ${this.index} must be exactly ${this.expected} bytes.`
        )
      );
      return;
    }
    this.received += buffer.length;
    callback(null, buffer);
  }
}

async function putUploadChunk(
  request: Request,
  sessionId: string,
  index: number,
  audience: ChunkSessionManifest["audience"],
  uploadLinkId?: string,
  signal = request.signal
): Promise<Response> {
  if (!PAGE_ID_PATTERN.test(sessionId)) {
    throw new ArtifactRequestError(400, "invalid_upload_id", "Upload ID is invalid.");
  }
  const manifest = await readChunkManifest(sessionId);
  if (!manifest) {
    throw new ArtifactRequestError(
      404,
      "upload_not_found",
      "The chunked upload was not found or expired."
    );
  }
  requireChunkAudience(manifest, audience, uploadLinkId);
  if (index < 0 || index >= manifest.totalChunks) {
    throw new ArtifactRequestError(400, "invalid_chunk_index", "Chunk index is out of range.");
  }
  if (!request.body) {
    throw new ArtifactRequestError(400, "invalid_chunk", "Chunk body is empty.");
  }
  const expected = expectedChunkBytes(manifest, index);
  const partPath = chunkPartPath(sessionId, index);
  const limiter = new ChunkLimitTransform(expected, index);
  const output = createWriteStream(partPath, { flags: "w" });
  try {
    const input = Readable.fromWeb(
      request.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>
    );
    await pipeline(input, limiter, output, { signal });
    const actual = (await stat(partPath)).size;
    if (actual !== expected) {
      throw new ArtifactRequestError(
        400,
        "invalid_chunk",
        `Chunk ${index} must be exactly ${expected} bytes.`
      );
    }
  } catch (error) {
    await safeUnlink(partPath);
    throw error;
  }
  return jsonResponse({ sessionId, index, bytes: expected });
}

async function completeChunkedUpload(
  request: Request,
  url: URL,
  options: FetchArtifactAppOptions,
  sessionId: string,
  gate: ReturnType<typeof createUploadGate>,
  maxUploadBytes: number,
  temporaryFileRetentionMs: number,
  activityTracker: ActivityTracker,
  audience: ChunkSessionManifest["audience"],
  uploadLink?: UploadLink,
  ensureActive?: () => Promise<boolean>
): Promise<Response> {
  if (!PAGE_ID_PATTERN.test(sessionId)) {
    throw new ArtifactRequestError(400, "invalid_upload_id", "Upload ID is invalid.");
  }
  const manifest = await readChunkManifest(sessionId);
  if (!manifest) {
    throw new ArtifactRequestError(
      404,
      "upload_not_found",
      "The chunked upload was not found or expired."
    );
  }
  requireChunkAudience(manifest, audience, uploadLink?.id);
  if (manifest.totalBytes > maxUploadBytes) {
    throw new ArtifactRequestError(
      413,
      "payload_too_large",
      "The uploaded file exceeds the configured size limit."
    );
  }
  const missing: number[] = [];
  for (let index = 0; index < manifest.totalChunks; index += 1) {
    try {
      const size = (await stat(chunkPartPath(sessionId, index))).size;
      if (size !== expectedChunkBytes(manifest, index)) missing.push(index);
    } catch {
      missing.push(index);
    }
  }
  if (missing.length > 0) {
    return jsonResponse(
      {
        error: "incomplete_upload",
        message: `Chunks ${missing.join(", ")} are still missing. Upload them, then complete the upload.`,
        missing
      },
      409
    );
  }

  const release = gate.tryAcquire();
  if (!release) {
    return jsonResponse(
      {
        error: "upload_capacity_reached",
        message: "The service is already processing its maximum number of uploads."
      },
      503,
      { Connection: "close", "Retry-After": "1" }
    );
  }

  return activityTracker.track(
    (async () => {
      let cleanupId: string | undefined;
      let responseSent = false;
      const dir = chunkSessionDir(sessionId);
      const assembledPath = path.join(dir, "assembled");
      try {
        const assembled = await open(assembledPath, "w");
        try {
          for (let index = 0; index < manifest.totalChunks; index += 1) {
            const part = createReadStream(chunkPartPath(sessionId, index), { signal: request.signal });
            for await (const chunk of part) {
              await assembled.write(chunk as Uint8Array);
            }
          }
        } finally {
          await assembled.close();
        }
        const assembledBytes = (await stat(assembledPath)).size;
        if (assembledBytes !== manifest.totalBytes) {
          throw new Error("Reassembled chunked upload has an unexpected size");
        }
        const id = generatePageId();
        const originalName = safeFileName(manifest.originalName, "download");
        const baseUrl = getPublicBaseUrl(request, options.publicBaseUrl);
        const sha256 = await sha256File(assembledPath, request.signal);
        throwIfAborted(request.signal);
        const expiresAt = uploadLink
          ? new Date(Math.max(uploadLink.expiresAt.getTime(), getNow(options).getTime() + temporaryFileRetentionMs))
          : new Date(getNow(options).getTime() + temporaryFileRetentionMs);
        cleanupId = id;
        if (ensureActive && !(await ensureActive())) {
          throw new ArtifactRequestError(
            404,
            "upload_link_unavailable",
            "This upload link has expired or was revoked."
          );
        }
        await options.storage.putTemporaryFile(
          id,
          assembledPath,
          {
            bytes: manifest.totalBytes,
            contentType: manifest.contentType,
            expiresAt,
            originalName,
            sha256,
            ...(uploadLink ? { uploadLinkId: uploadLink.id } : {})
          },
          { signal: request.signal }
        );
        throwIfAborted(request.signal);
        responseSent = true;
        return jsonResponse(
          {
            id,
            kind: "file",
            filename: originalName,
            contentType: manifest.contentType,
            url: `${baseUrl}/files/${id}/${encodeURIComponent(originalName)}`,
            bytes: manifest.totalBytes,
            expiresAt: expiresAt.toISOString(),
            sha256
          },
          201
        );
      } catch (error) {
        if (cleanupId && !responseSent) {
          try {
            await options.storage.deleteUpload(cleanupId, { signal: request.signal });
          } catch (cleanupError) {
            console.error("failed to clean up an interrupted upload", cleanupError);
          }
        }
        throw error;
      } finally {
        release();
        await removeChunkSession(sessionId);
      }
    })()
  ).then(
    (response) => response,
    (error) => artifactErrorResponse(error)
  );
}

async function abortChunkedUpload(
  sessionId: string,
  audience: ChunkSessionManifest["audience"],
  uploadLinkId?: string
): Promise<Response> {
  if (!PAGE_ID_PATTERN.test(sessionId)) {
    throw new ArtifactRequestError(400, "invalid_upload_id", "Upload ID is invalid.");
  }
  const manifest = await readChunkManifest(sessionId);
  if (manifest) requireChunkAudience(manifest, audience, uploadLinkId);
  await removeChunkSession(sessionId);
  return new Response(null, { status: 204 });
}

function requireChunkAudience(
  manifest: ChunkSessionManifest,
  audience: ChunkSessionManifest["audience"],
  uploadLinkId?: string
) {
  if (manifest.audience !== audience || (audience === "drop" && manifest.uploadLinkId !== uploadLinkId)) {
    throw new ArtifactRequestError(
      404,
      "upload_not_found",
      "The chunked upload was not found or expired."
    );
  }
}

type UploadMode =
  | {
      kind: "create";
      temporaryOnly?: boolean;
      uploadLinkId?: string;
      expiresAt?: Date;
      ensureActive?: () => Promise<boolean>;
    }
  | { kind: "update"; id: string };

type StagedUpload = {
  filePath: string;
  originalName: string;
  contentType: string;
  bytes: number;
  project?: string;
};

async function stageMultipart(
  request: Request,
  options: {
    maxUploadBytes: number;
    maxHtmlUploadBytes: number;
    temporaryOnly: boolean;
    signal: AbortSignal;
  }
): Promise<StagedUpload> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!isMultipartContentType(contentType)) {
    throw new ArtifactRequestError(
      415,
      "unsupported_media_type",
      "Expected multipart/form-data with a boundary."
    );
  }
  if (!request.body) {
    throw new ArtifactRequestError(
      400,
      "invalid_multipart_upload",
      "The multipart upload could not be parsed."
    );
  }

  const parser = busboy({
    headers: { "content-type": contentType },
    defParamCharset: "utf8",
    limits: {
      fieldNameSize: 64,
      fieldSize: MAX_PROJECT_NAME_BYTES,
      fields: 1,
      files: 1,
      fileSize: options.maxUploadBytes,
      headerPairs: 100,
      parts: 3
    }
  });
  const input = Readable.fromWeb(
    request.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>
  );
  let filePromise: Promise<StagedUpload> | undefined;
  let parserError: unknown;
  let fileCount = 0;
  let project: string | undefined;

  parser.on("file", (fieldName, stream, info) => {
    fileCount += 1;
    if (fieldName !== "file" || fileCount > 1) {
      stream.resume();
      parserError ??= new ArtifactRequestError(
        400,
        "invalid_multipart_upload",
        "Expected exactly one file in multipart field `file`."
      );
      return;
    }
    const classification = classifyUpload(info.filename, info.mimeType, options.temporaryOnly);
    const maxBytes =
      classification.kind === "html" ? options.maxHtmlUploadBytes : options.maxUploadBytes;
    filePromise = stageFile(stream, info.filename, info.mimeType, maxBytes, options.signal);
    stream.on("limit", () => {
      parserError ??=
        classification.kind === "html"
          ? new HtmlPayloadTooLargeError(maxBytes, 0)
          : new ArtifactRequestError(
              413,
              "payload_too_large",
              "The uploaded file exceeds the configured size limit."
            );
    });
    filePromise.catch((error) => {
      parserError ??= error;
      parser.destroy(error instanceof Error ? error : new Error("Multipart staging failed"));
    });
  });
  parser.on("field", (fieldName, value, info) => {
    const normalized = normalizeProjectName(value);
    if (fieldName !== "project" || info.valueTruncated || !normalized || project) {
      parserError ??= new ArtifactRequestError(
        400,
        "invalid_project",
        "Project must be a single non-empty multipart field of at most 240 UTF-8 bytes."
      );
      return;
    }
    project = normalized;
  });
  parser.on("fieldsLimit", () => {
    parserError ??= new ArtifactRequestError(
      400,
      "invalid_project",
      "Only one optional multipart field named `project` is supported."
    );
  });
  parser.on("filesLimit", () => {
    parserError ??= new ArtifactRequestError(
      400,
      "invalid_multipart_upload",
      "Expected exactly one file in multipart field `file`."
    );
  });
  parser.on("partsLimit", () => {
    parserError ??= new ArtifactRequestError(
      400,
      "invalid_multipart_upload",
      "Expected exactly one file in multipart field `file`."
    );
  });
  parser.on("error", (error) => {
    parserError ??= error;
  });

  const parserDone = new Promise<void>((resolve) => parser.once("close", resolve));
  input.on("error", (error) => parser.destroy(error));
  const abort = () => {
    const reason = options.signal.reason instanceof Error
      ? options.signal.reason
      : new DOMException("Upload aborted", "AbortError");
    input.destroy(reason);
    parser.destroy(reason);
  };
  if (options.signal.aborted) abort();
  else options.signal.addEventListener("abort", abort, { once: true });
  input.pipe(parser);
  try {
    await parserDone;
  } finally {
    options.signal.removeEventListener("abort", abort);
  }
  const staged = await filePromise?.catch((error) => {
    parserError ??= error;
    return undefined;
  });
  if (parserError) {
    if (staged) await safeUnlink(staged.filePath);
    throw parserError;
  }
  if (!staged || fileCount !== 1) {
    if (staged) await safeUnlink(staged.filePath);
    throw new ArtifactRequestError(
      400,
      "missing_file",
      "Expected multipart field `file`."
    );
  }
  return { ...staged, ...(project ? { project } : {}) };
}

async function stageFile(
  stream: Readable,
  originalName: string,
  contentType: string,
  maxBytes: number,
  signal: AbortSignal
): Promise<StagedUpload> {
  const filePath = path.join(
    os.tmpdir(),
    `artifact-publisher-${crypto.randomBytes(16).toString("hex")}`
  );
  const limiter = new ByteLimitTransform(maxBytes);
  const output = createWriteStream(filePath, { flags: "wx" });
  try {
    await pipeline(stream, limiter, output, { signal });
    if ((stream as Readable & { truncated?: boolean }).truncated) {
      throw new ArtifactRequestError(
        413,
        "payload_too_large",
        "The uploaded file exceeds the configured size limit."
      );
    }
    return {
      filePath,
      originalName,
      contentType: normalizeMimeType(contentType),
      bytes: limiter.bytesAccepted
    };
  } catch (error) {
    await safeUnlink(filePath);
    throw error;
  }
}

class ByteLimitTransform extends Transform {
  bytesAccepted = 0;

  constructor(private readonly maxBytes: number) {
    super();
  }

  override _transform(
    chunk: unknown,
    encoding: BufferEncoding,
    callback: TransformCallback
  ) {
    const buffer = typeof chunk === "string"
      ? Buffer.from(chunk, encoding)
      : chunk instanceof Uint8Array
        ? Buffer.from(chunk)
        : undefined;
    if (!buffer) {
      callback(new TypeError("Multipart file stream emitted a non-byte chunk"));
      return;
    }
    if (this.bytesAccepted + buffer.length > this.maxBytes) {
      const error = new HtmlPayloadTooLargeError(this.maxBytes, this.bytesAccepted);
      callback(error);
      return;
    }
    this.bytesAccepted += buffer.length;
    callback(null, buffer);
  }
}

/** Adds the Publisher favicon without changing the artifact stored in object storage. */
class PublisherFaviconTransform extends Transform {
  private buffered = Buffer.alloc(0);
  private injected = false;

  constructor(private readonly favicon: Buffer) {
    super();
  }

  override _transform(
    chunk: unknown,
    encoding: BufferEncoding,
    callback: TransformCallback
  ) {
    const buffer = typeof chunk === "string"
      ? Buffer.from(chunk, encoding)
      : chunk instanceof Uint8Array
        ? Buffer.from(chunk)
        : undefined;
    if (!buffer) {
      callback(new TypeError("Stored HTML stream emitted a non-byte chunk"));
      return;
    }

    if (this.injected) {
      callback(null, buffer);
      return;
    }

    this.buffered = Buffer.concat([this.buffered, buffer]);
    const closingHead = this.buffered.toString("latin1").toLowerCase().indexOf("</head");
    if (closingHead >= 0) {
      this.push(this.buffered.subarray(0, closingHead));
      this.push(this.favicon);
      this.push(this.buffered.subarray(closingHead));
      this.buffered = Buffer.alloc(0);
      this.injected = true;
      callback();
      return;
    }

    if (this.buffered.length >= HTML_HEAD_BUFFER_LIMIT) {
      this.push(injectPublisherFavicon(this.buffered, this.favicon));
      this.buffered = Buffer.alloc(0);
      this.injected = true;
    }
    callback();
  }

  override _flush(callback: TransformCallback) {
    this.push(
      this.injected ? this.buffered : injectPublisherFavicon(this.buffered, this.favicon)
    );
    callback();
  }
}

function injectPublisherFavicon(html: Buffer, favicon: Buffer) {
  const source = html.toString("latin1");
  const openingHead = /<head(?:\s[^>]*)?>/i.exec(source);
  if (openingHead?.index !== undefined) {
    const insertion = openingHead.index + openingHead[0].length;
    return Buffer.concat([
      html.subarray(0, insertion),
      favicon,
      html.subarray(insertion)
    ]);
  }

  const doctype = /<!doctype\s[^>]*>/i.exec(source);
  const insertion = doctype?.index === 0 ? doctype[0].length : 0;
  return Buffer.concat([
    html.subarray(0, insertion),
    favicon,
    html.subarray(insertion)
  ]);
}

function classifyUpload(
  originalName: string,
  mimeType: string,
  temporaryOnly: boolean
): UploadClassification {
  const extension = path.extname(originalName).toLowerCase();
  const normalizedMimeType = normalizeMimeType(mimeType);
  if (!temporaryOnly && HTML_EXTENSIONS.has(extension) && HTML_MIME_TYPES.has(normalizedMimeType)) {
    return { kind: "html" };
  }
  return { kind: "temporary", contentType: normalizedMimeType };
}

type UploadClassification =
  | { kind: "html" }
  | { kind: "temporary"; contentType: string };

function requireUploadToken(value: string) {
  if (!value) throw new Error("UPLOAD_TOKEN must not be empty");
  return value;
}

function requireBearer(request: Request, expectedToken: string) {
  const authorization = request.headers.get("authorization");
  if (!authorization || !constantTimeEquals(authorization, `Bearer ${expectedToken}`)) {
    throw new ArtifactRequestError(
      401,
      "unauthorized",
      "A valid upload bearer token is required.",
      { "WWW-Authenticate": 'Bearer realm="uploads"' }
    );
  }
}

function requireSameOrigin(request: Request, url: URL, publicBaseUrl?: string) {
  const origin = request.headers.get("origin");
  const expectedOrigin = publicBaseUrl ? new URL(publicBaseUrl).origin : url.origin;
  if (!origin || !isValidHost(url.host) || origin !== expectedOrigin) {
    throw new ArtifactRequestError(
      403,
      "invalid_origin",
      "External uploads must come from the upload website."
    );
  }
}

function requireMultipartUpload(request: Request) {
  if (!isMultipartContentType(request.headers.get("content-type") ?? "")) {
    throw new ArtifactRequestError(
      415,
      "unsupported_media_type",
      "Expected multipart/form-data with a boundary."
    );
  }
}

async function readUploadUpdate(request: Request, now: Date): Promise<
  | { kind: "project"; project: string }
  | { kind: "expiry"; expiresAt: Date | null }
> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new ArtifactRequestError(
      415,
      "unsupported_media_type",
      "Expected application/json."
    );
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > 1024) {
    throw new ArtifactRequestError(413, "payload_too_large", "Upload update is too large.");
  }
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new ArtifactRequestError(400, "invalid_upload_update", "Upload update is invalid JSON.");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ArtifactRequestError(
      400,
      "invalid_upload_update",
      "Upload update must contain a project or expiresAt value."
    );
  }
  const keys = Object.keys(input);
  if (keys.length !== 1 || (keys[0] !== "project" && keys[0] !== "expiresAt")) {
    throw new ArtifactRequestError(
      400,
      "invalid_upload_update",
      "Upload update must contain only a project or expiresAt value."
    );
  }
  if ("project" in input) {
    const project = normalizeProjectName(String(input.project));
    if (!project) {
      throw new ArtifactRequestError(
        400,
        "invalid_project",
        "Project must be a non-empty string of at most 240 UTF-8 bytes."
      );
    }
    return { kind: "project", project };
  }
  if (!("expiresAt" in input)) {
    throw new ArtifactRequestError(
      400,
      "invalid_upload_update",
      "Upload update must contain a project or expiresAt value."
    );
  }
  if (input.expiresAt === null) return { kind: "expiry", expiresAt: null };
  if (typeof input.expiresAt !== "string") {
    throw new ArtifactRequestError(400, "invalid_expiry", "expiresAt must be an ISO timestamp or null.");
  }
  const expiresAt = new Date(input.expiresAt);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.toISOString() !== input.expiresAt) {
    throw new ArtifactRequestError(400, "invalid_expiry", "expiresAt must be an ISO timestamp or null.");
  }
  if (expiresAt <= now) {
    throw new ArtifactRequestError(400, "invalid_expiry", "File expiry must be in the future.");
  }
  if (expiresAt.getTime() - now.getTime() > MAX_TEMPORARY_FILE_RETENTION_MS) {
    throw new ArtifactRequestError(400, "invalid_expiry", "File expiry cannot be more than 100 years away.");
  }
  return { kind: "expiry", expiresAt };
}

function isExpired(expiresAt: Date | undefined, now: Date) {
  return Boolean(expiresAt && expiresAt <= now);
}

function isMultipartContentType(contentType: string) {
  return /^multipart\/form-data\s*;\s*boundary=(?:"[^"]+"|[^;\s]+)$/i.test(
    contentType
  );
}

function constantTimeEquals(actual: string, expected: string) {
  const actualHash = crypto.createHash("sha256").update(actual).digest();
  const expectedHash = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(actualHash, expectedHash);
}

function getPublicBaseUrl(request: Request, configuredBaseUrl?: string) {
  if (configuredBaseUrl) return configuredBaseUrl.replace(/\/+$/, "");
  const url = new URL(request.url);
  if (!isValidHost(url.host)) throw new Error("Unable to derive a valid public base URL");
  return url.origin;
}

function isExternalUploadPagePath(pathname: string) {
  return ["/publish", "/publish/callback", "/uploads", "/uploads/callback"].includes(pathname);
}

function isExternalUploadAssetPath(pathname: string) {
  return [
    "/publish/app.css",
    `/publish/assets/${EXTERNAL_UPLOAD_ASSET_VERSION}/app.css`,
    "/uploads/app.css",
    `/uploads/assets/${EXTERNAL_UPLOAD_ASSET_VERSION}/app.css`,
    "/publish/app.js",
    `/publish/assets/${EXTERNAL_UPLOAD_ASSET_VERSION}/app.js`,
    "/uploads/app.js",
    `/uploads/assets/${EXTERNAL_UPLOAD_ASSET_VERSION}/app.js`
  ].includes(pathname);
}

function externalUploadUnavailable() {
  return jsonResponse(
    {
      error: "external_upload_unavailable",
      message: "External uploads are not configured."
    },
    503
  );
}

function withExternalUploadHeaders(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", EXTERNAL_UPLOAD_CSP);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  return new Response(response.body, {
    status: response.status,
    headers
  });
}

function withDropUploadHeaders(response: Response, nonce?: string) {
  const headers = new Headers(response.headers);
  const inline = nonce ? `'nonce-${nonce}'` : "'none'";
  headers.set("Content-Security-Policy", `default-src 'none'; connect-src 'self'; img-src 'self'; script-src ${inline}; style-src ${inline}; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Robots-Tag", "noindex, nofollow");
  return new Response(response.body, { status: response.status, headers });
}

function matchDropPage(pathname: string) {
  const match = /^\/drop\/([^/]+)\/?$/.exec(pathname);
  return match?.[1] && UPLOAD_LINK_TOKEN_PATTERN.test(match[1]) ? match[1] : undefined;
}

function matchDropUpload(pathname: string) {
  const match = /^\/api\/drop\/([^/]+)\/uploads$/.exec(pathname);
  return match?.[1] && UPLOAD_LINK_TOKEN_PATTERN.test(match[1]) ? match[1] : undefined;
}

function matchDropChunk(pathname: string) {
  const match = /^\/api\/drop\/([^/]+)\/uploads\/chunks(?:\/(.*))?$/.exec(pathname);
  if (!match?.[1] || !UPLOAD_LINK_TOKEN_PATTERN.test(match[1])) return undefined;
  return { token: match[1], remainder: match[2] ?? "" };
}

function requireUploadLinks(options: FetchArtifactAppOptions) {
  if (!options.uploadLinks) {
    throw new ArtifactRequestError(503, "upload_links_unavailable", "Upload links are not configured.");
  }
}

async function readUploadLinkDuration(request: Request, url: URL) {
  const queryDurations = url.searchParams.getAll("durationMs");
  if (queryDurations.length > 0) {
    const rawDuration = queryDurations[0]!;
    if (queryDurations.length !== 1 || !/^\d+$/.test(rawDuration)) {
      throw invalidUploadLinkDuration();
    }
    return validateUploadLinkDuration(Number(rawDuration));
  }
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new ArtifactRequestError(415, "unsupported_media_type", "Expected application/json.");
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > 1024) {
    throw new ArtifactRequestError(413, "payload_too_large", "Upload link request is too large.");
  }
  let input: unknown;
  try { input = JSON.parse(raw); }
  catch { throw new ArtifactRequestError(400, "invalid_upload_link", "Upload link request is invalid JSON."); }
  return validateUploadLinkDuration((input as { durationMs?: unknown } | null)?.durationMs);
}

function validateUploadLinkDuration(durationMs: unknown) {
  if (!Number.isSafeInteger(durationMs) || (durationMs as number) < MIN_UPLOAD_LINK_DURATION_MS || (durationMs as number) > MAX_UPLOAD_LINK_DURATION_MS) {
    throw invalidUploadLinkDuration();
  }
  return durationMs as number;
}

function invalidUploadLinkDuration() {
  return new ArtifactRequestError(400, "invalid_upload_link_duration", "Duration must be between 5 minutes and 30 days.");
}

function serializeUploadLink(link: UploadLink) {
  return {
    id: link.id,
    createdAt: link.createdAt.toISOString(),
    expiresAt: link.expiresAt.toISOString(),
    fileCount: link.fileCount,
    ...(link.revokedAt ? { revokedAt: link.revokedAt.toISOString() } : {})
  };
}

function dropLinkNotFound() {
  return withDropUploadHeaders(new Response("This upload link is unavailable.", {
    status: 404,
    headers: { "Cache-Control": "private, no-store", "Content-Type": "text/plain; charset=utf-8" }
  }));
}

function dropLinkUnavailable() {
  return jsonResponse({
    error: "upload_link_unavailable",
    message: "This upload link has expired or was revoked."
  }, 404);
}

function downloadUploadLinkFiles(
  files: readonly { id: string; filename: string }[],
  storage: UploadStorage,
  linkId: string,
  signal: AbortSignal,
  activityTracker: ActivityTracker
) {
  const output = createArchiveOutput();
  const archive = new ZipWriter(output.writable, {
    zip64: true,
    level: 0,
    useWebWorkers: false
  });
  const production = (async () => {
    const usedNames = new Set<string>();
    try {
      for (const file of files) {
        if (signal.aborted) throw new DOMException("Download aborted", "AbortError");
        const stored = await storage.getTemporaryFile(file.id, { signal });
        if (!stored) {
          throw new Error(`Upload-link file ${file.id} disappeared during archive creation`);
        }
        await archive.add(
          uniqueArchiveName(file.filename, usedNames),
          Readable.toWeb(stored.body) as ReadableStream<Uint8Array>,
          { signal, zip64: true, level: 0, useWebWorkers: false }
        );
      }
      await archive.close(undefined, { zip64: true });
    } catch (error) {
      output.fail(error);
      console.error("failed to stream upload-link archive", error);
    }
  })();
  void activityTracker.track(production);
  return new Response(output.readable, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": attachmentDisposition(`uploads-${linkId.slice(0, 8)}.zip`),
      "Content-Type": "application/zip",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function createArchiveOutput() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  let resume: (() => void) | undefined;
  const readable = new ReadableStream<Uint8Array>({
    start(value) { controller = value; },
    pull() { resume?.(); resume = undefined; },
    cancel() { closed = true; resume?.(); resume = undefined; }
  });
  const fail = (reason: unknown) => {
    if (closed) return;
    closed = true;
    resume?.();
    resume = undefined;
    controller.error(reason);
  };
  const writable = new WritableStream<Uint8Array>({
    async write(chunk) {
      if (closed) throw new DOMException("Archive output is closed", "AbortError");
      controller.enqueue(chunk);
      if ((controller.desiredSize ?? 1) <= 0) {
        await new Promise<void>((resolve) => { resume = resolve; });
      }
    },
    close() {
      if (!closed) { closed = true; controller.close(); }
    },
    abort: fail
  });
  return { readable, writable, fail };
}

function uniqueArchiveName(filename: string, used: Set<string>) {
  const safe = portableArchiveName(safeFileName(filename, "download"));
  const key = archiveNameKey(safe);
  if (!used.has(key)) { used.add(key); return safe; }
  const extensionAt = safe.lastIndexOf(".");
  const stem = extensionAt > 0 ? safe.slice(0, extensionAt) : safe;
  const extension = extensionAt > 0 ? safe.slice(extensionAt) : "";
  for (let index = 2; ; index += 1) {
    const suffix = ` (${index})`;
    const stemBudget = Math.max(
      0,
      MAX_FILE_NAME_BYTES - Buffer.byteLength(suffix + extension, "utf8")
    );
    const boundedStem = truncateArchiveName(stem, stemBudget);
    const candidate = truncateArchiveName(
      `${boundedStem}${suffix}${extension}`,
      MAX_FILE_NAME_BYTES
    );
    const candidateKey = archiveNameKey(candidate);
    if (!used.has(candidateKey)) { used.add(candidateKey); return candidate; }
  }
}

function truncateArchiveName(value: string, maxBytes: number) {
  let result = "";
  let bytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (bytes + characterBytes > maxBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

function portableArchiveName(filename: string) {
  let portable = filename
    .replace(/[\u0000-\u001F\u007F<>:"/\\|?*]/g, "_")
    .replace(/[ .]+$/g, (suffix) => "_".repeat(suffix.length));
  const deviceStem = portable.split(".", 1)[0]?.replace(/[ .]+$/g, "").normalize("NFKC") ?? "";
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9]|conin\$|conout\$)$/i.test(deviceStem)) {
    portable = `_${portable.slice(1)}`;
  }
  return portable;
}

function archiveNameKey(filename: string) {
  return filename.normalize("NFKC").toLocaleLowerCase("en-US");
}

function matchCapabilityPath(pathname: string, prefixes: readonly string[]) {
  for (const prefix of prefixes) {
    if (pathname.startsWith(prefix)) return pathname.slice(prefix.length);
  }
  return undefined;
}

function matchFilePath(pathname: string) {
  for (const prefix of ["/files/", "/f/"]) {
    if (!pathname.startsWith(prefix)) continue;
    const rest = pathname.slice(prefix.length);
    const separator = rest.indexOf("/");
    if (separator < 1) return undefined;
    return { id: rest.slice(0, separator) };
  }
  return undefined;
}

function matchPath(pathname: string, prefix: string) {
  return pathname.startsWith(prefix) ? pathname.slice(prefix.length) : undefined;
}

function applyRepresentationHeaders(
  headers: Headers,
  bytes: number,
  sha256?: string,
  lastModified?: Date
) {
  if (Number.isSafeInteger(bytes) && bytes >= 0) headers.set("Content-Length", String(bytes));
  const etag = sha256Etag(sha256);
  if (etag) headers.set("ETag", etag);
  if (lastModified && !Number.isNaN(lastModified.getTime())) {
    headers.set("Last-Modified", lastModified.toUTCString());
  }
}

function isNotModified(request: Request, headers: Headers) {
  const etag = headers.get("ETag");
  const ifNoneMatch = request.headers.get("if-none-match");
  if (etag && ifNoneMatch) {
    return ifNoneMatch.split(",").some((candidate) => candidate.trim() === etag);
  }
  const lastModified = headers.get("Last-Modified");
  const ifModifiedSince = request.headers.get("if-modified-since");
  return Boolean(
    lastModified &&
      ifModifiedSince &&
      Date.parse(lastModified) <= Date.parse(ifModifiedSince)
  );
}

function requestedRange(request: Request) {
  const range = request.headers.get("range");
  if (!range) return undefined;
  return range.length <= 100 && SINGLE_BYTE_RANGE_PATTERN.test(range) ? range : null;
}

function ifRangeAllowsPartialResponse(
  validator: string,
  sha256?: string,
  lastModified?: Date
) {
  const value = validator.trim();
  const etag = sha256Etag(sha256);
  if (value.startsWith('"') || value.startsWith("W/")) return Boolean(etag && value === etag);
  const validatorDate = parseHttpDate(value);
  return Boolean(
    validatorDate &&
      lastModified &&
      !Number.isNaN(lastModified.getTime()) &&
      Math.floor(lastModified.getTime() / 1000) <= Math.floor(validatorDate.getTime() / 1000)
  );
}

function sha256Etag(sha256: string | undefined) {
  return sha256 && /^[a-f0-9]{64}$/i.test(sha256)
    ? `"sha256-${sha256.toLowerCase()}"`
    : undefined;
}

function htmlRepresentationSha256(storedSha256: string | undefined, favicon: Buffer) {
  if (!storedSha256 || !/^[a-f0-9]{64}$/i.test(storedSha256)) return undefined;
  return crypto
    .createHash("sha256")
    .update("publisher-favicon-v2\0")
    .update(favicon)
    .update("\0")
    .update(storedSha256.toLowerCase())
    .digest("hex");
}

function publisherFaviconLink(url = DEFAULT_PUBLISHER_FAVICON_URL) {
  if (!url.startsWith("/") || url.startsWith("//") || /[\s"<>]/.test(url)) {
    throw new Error("publisherFaviconUrl must be a safe root-relative URL");
  }
  return Buffer.from(
    `<link rel="icon" href="${url}" type="image/png" sizes="96x96">`
  );
}

function parseHttpDate(value: string) {
  if (
    !/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)
  ) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  return date.toUTCString() === value ? date : null;
}

function rangeNotSatisfiable(totalBytes?: number) {
  const headers = new Headers({ "Accept-Ranges": "bytes" });
  if (totalBytes !== undefined) headers.set("Content-Range", `bytes */${totalBytes}`);
  return jsonResponse(
    {
      error: "range_not_satisfiable",
      message: "Only one satisfiable byte range is supported."
    },
    416,
    headers
  );
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
  const result = new Headers(headers);
  result.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers: result });
}

class ArtifactRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers?: HeadersInit
  ) {
    super(message);
    this.name = "ArtifactRequestError";
  }
}

export class HtmlPayloadTooLargeError extends Error {
  readonly code = "HTML_PAYLOAD_TOO_LARGE";

  constructor(readonly limitBytes: number, readonly stagedBytes: number) {
    super(`HTML uploads may not exceed ${limitBytes} bytes.`);
    this.name = "HtmlPayloadTooLargeError";
  }
}

function artifactErrorResponse(error: unknown) {
  if (error instanceof ArtifactRequestError) {
    return jsonResponse({ error: error.code, message: error.message }, error.status, error.headers);
  }
  if (error instanceof HtmlPayloadTooLargeError) {
    return jsonResponse({ error: "html_payload_too_large", message: error.message }, 413);
  }
  if (error instanceof UploadLinkInactiveError) {
    return jsonResponse({ error: "upload_link_unavailable", message: error.message }, 404);
  }
  if (error instanceof URIError) {
    return new Response(null, { status: 404 });
  }
  console.error(JSON.stringify({
    event: "artifact.request_failed",
    errorType: error instanceof Error ? error.name : "UnknownError",
    ...postgresErrorCode(error)
  }));
  return jsonResponse(
    { error: "internal_server_error", message: "The request failed." },
    500
  );
}

function postgresErrorCode(error: unknown): { errorCode?: string } {
  const code = findErrorCode(error, new Set());
  return typeof code === "string" ? { errorCode: code } : {};
}

function findErrorCode(error: unknown, seen: Set<unknown>): string | undefined {
  if (!(error instanceof Error) || seen.has(error)) return undefined;
  seen.add(error);
  const code = (error as Error & { code?: unknown }).code;
  if (typeof code === "string") return code;
  if (error instanceof AggregateError) {
    for (const nested of error.errors) {
      const nestedCode = findErrorCode(nested, seen);
      if (nestedCode) return nestedCode;
    }
  }
  return findErrorCode(error.cause, seen);
}

function encodeUploadListCursor(
  cursor: UploadListCursor,
  criteria = cursor.criteria ?? "legacy:newest",
  originalName = cursor.originalName ?? cursor.key
) {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      criteria,
      updatedAt: cursor.updatedAt.toISOString(),
      key: cursor.key,
      originalName,
      ...(cursor.expiresAt ? { expiresAt: cursor.expiresAt.toISOString() } : {})
    }),
    "utf8"
  ).toString("base64url");
}

function encodeUploadLinkCursor(link: Pick<UploadLink, "createdAt" | "id">) {
  return Buffer.from(JSON.stringify({
    version: 1,
    createdAt: link.createdAt.toISOString(),
    id: link.id
  }), "utf8").toString("base64url");
}

function parseUploadLinkCursor(value: string | undefined) {
  if (value === undefined) return undefined;
  if (!value || value.length > MAX_UPLOAD_LIST_CURSOR_LENGTH) {
    throw new ArtifactRequestError(400, "invalid_pagination", "cursor is invalid.");
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") throw new Error("invalid cursor");
    const candidate = parsed as Record<string, unknown>;
    if (candidate.version !== 1 || typeof candidate.createdAt !== "string" ||
      typeof candidate.id !== "string" || !UUID_PATTERN.test(candidate.id)) {
      throw new Error("invalid cursor");
    }
    const createdAt = new Date(candidate.createdAt);
    if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== candidate.createdAt) {
      throw new Error("invalid cursor");
    }
    return { createdAt, id: candidate.id };
  } catch {
    throw new ArtifactRequestError(400, "invalid_pagination", "cursor is invalid.");
  }
}

function parseUploadListOptions(search: URLSearchParams): Omit<ListUploadsOptions, "signal"> {
  const rawLimit = singleQuery(search, "limit");
  const rawKind = singleQuery(search, "kind");
  const rawCursor = singleQuery(search, "cursor");
  const rawQuery = singleQuery(search, "q");
  const rawExpiry = singleQuery(search, "expiry");
  const rawSort = singleQuery(search, "sort");
  const rawIncludeSummary = singleQuery(search, "includeSummary");
  const limit = rawLimit === undefined ? DEFAULT_UPLOAD_LIST_LIMIT : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_UPLOAD_LIST_LIMIT) {
    throw new ArtifactRequestError(
      400,
      "invalid_pagination",
      `limit must be an integer between 1 and ${MAX_UPLOAD_LIST_LIMIT}.`
    );
  }
  if (rawQuery !== undefined && rawQuery.length > 200) {
    throw new ArtifactRequestError(400, "invalid_pagination", "q must be at most 200 characters.");
  }
  const q = rawQuery?.trim().normalize("NFKC").toLowerCase() ?? "";
  const expiry: UploadExpiryFilter = rawExpiry === undefined || rawExpiry === "all"
    ? "all"
    : rawExpiry === "24h" || rawExpiry === "7d" || rawExpiry === "persistent"
      ? rawExpiry
      : (() => { throw new ArtifactRequestError(400, "invalid_pagination", "expiry must be all, 24h, 7d, or persistent."); })();
  const sort: UploadListSort = rawSort === undefined
    ? "newest"
    : rawSort === "newest" || rawSort === "oldest" || rawSort === "filename" || rawSort === "expiry"
      ? rawSort
      : (() => { throw new ArtifactRequestError(400, "invalid_pagination", "sort must be newest, oldest, filename, or expiry."); })();
  const kind = rawKind === undefined || rawKind === "all"
    ? undefined
    : rawKind === "html" || rawKind === "file"
      ? rawKind
      : (() => { throw new ArtifactRequestError(400, "invalid_pagination", "kind must be all, html, or file."); })();
  const criteria = JSON.stringify({ q, kind: kind ?? "all", expiry, sort });
  const cursor = rawCursor === undefined ? undefined : decodeUploadListCursor(rawCursor, criteria, q === "" && expiry === "all" && sort === "newest");
  if (rawIncludeSummary !== undefined && rawIncludeSummary !== "true") {
    throw new ArtifactRequestError(400, "invalid_pagination", "includeSummary must be true when provided.");
  }
  return {
    limit,
    ...(rawIncludeSummary === "true" ? { includeSummary: true } : {}),
    criteria,
    ...(kind ? { kind } : {}),
    ...(q ? { q } : {}),
    expiry,
    sort,
    ...(cursor ? { cursor } : {})
  };
}

function singleQuery(search: URLSearchParams, name: string) {
  const values = search.getAll(name);
  if (values.length > 1) {
    throw new ArtifactRequestError(400, "invalid_pagination", "Pagination parameters must be single values.");
  }
  return values[0];
}

function decodeUploadListCursor(value: string, criteria: string, legacyCompatible: boolean): UploadListCursor {
  if (!value || value.length > MAX_UPLOAD_LIST_CURSOR_LENGTH) {
    throw new ArtifactRequestError(400, "invalid_pagination", "cursor is invalid.");
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") throw new Error("invalid cursor");
    const candidate = parsed as Record<string, unknown>;
    if (
      typeof candidate.updatedAt !== "string" ||
      typeof candidate.key !== "string" ||
      !UPLOAD_KEY_PATTERN.test(candidate.key)
    ) throw new Error("invalid cursor");
    const updatedAt = new Date(candidate.updatedAt);
    if (Number.isNaN(updatedAt.getTime()) || updatedAt.toISOString() !== candidate.updatedAt) throw new Error("invalid cursor");
    if (candidate.version === undefined) {
      if (!legacyCompatible || candidate.criteria !== undefined || candidate.originalName !== undefined || candidate.expiresAt !== undefined) throw new Error("invalid cursor");
      return { updatedAt, key: candidate.key };
    }
    if (candidate.version !== 1 || candidate.criteria !== criteria || typeof candidate.originalName !== "string") throw new Error("invalid cursor");
    let expiresAt: Date | undefined;
    if (candidate.expiresAt !== undefined) {
      if (typeof candidate.expiresAt !== "string") throw new Error("invalid cursor");
      expiresAt = new Date(candidate.expiresAt);
      if (Number.isNaN(expiresAt.getTime()) || expiresAt.toISOString() !== candidate.expiresAt) throw new Error("invalid cursor");
    }
    return {
      version: 1,
      criteria: candidate.criteria,
      updatedAt,
      key: candidate.key,
      originalName: candidate.originalName,
      ...(expiresAt ? { expiresAt } : {})
    };
  } catch {
    throw new ArtifactRequestError(400, "invalid_pagination", "cursor is invalid.");
  }
}

async function sha256File(filePath: string, signal: AbortSignal) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(filePath, { signal })) hash.update(chunk);
  return hash.digest("hex");
}

async function safeUnlink(filePath: string) {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") console.error(error);
  }
}

function getNow(options: FetchArtifactAppOptions) {
  return options.now?.() ?? new Date();
}

function generatePageId() {
  return crypto.randomBytes(24).toString("base64url");
}

function isValidHost(host: string) {
  return (
    /^[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(host) ||
    /^\[[0-9A-Fa-f:]+\](?::\d{1,5})?$/.test(host)
  );
}

function toWebStream(stream: Readable) {
  return Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Operation aborted");
}

async function consumeBody(request: Request) {
  if (request.body) await request.body.cancel();
}

function positiveIntegerOption(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function createUploadGate(maxConcurrentUploads: number) {
  let activeUploads = 0;
  return {
    tryAcquire() {
      if (activeUploads >= maxConcurrentUploads) return null;
      activeUploads += 1;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          activeUploads -= 1;
        }
      };
    }
  };
}

function tracked<T>(tracker: ActivityTracker, operation: () => Promise<T>, signal: AbortSignal) {
  return tracker.track(operation()).catch((error) => {
    if (signal.aborted) throw error;
    return artifactErrorResponse(error) as T;
  });
}

function formatRetention(retentionMs: number) {
  const dayMs = 24 * 60 * 60 * 1000;
  const hourMs = 60 * 60 * 1000;
  if (retentionMs % dayMs === 0) {
    const days = retentionMs / dayMs;
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  if (retentionMs % hourMs === 0) {
    const hours = retentionMs / hourMs;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return "the configured retention period";
}

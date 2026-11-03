import { Readable } from "node:stream";
import { contentDisposition, fileDelivery, normalizeMimeType } from "./file-metadata.js";
import { RangeNotSatisfiableError, type UploadStorage } from "./storage.js";

const PAGE_ID_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const SINGLE_BYTE_RANGE_PATTERN = /^bytes=(?:\d+-\d*|-\d+)$/i;
// The media element keeps using the redirected URL for later seeks. Cover long
// playback sessions while still capping a signature at the file's expiry.
const DIRECT_VIDEO_URL_SECONDS = 4 * 60 * 60;

type FileResponseOptions = {
  storage: Pick<UploadStorage, "getTemporaryFile" | "presignTemporaryFile">;
  now?: () => Date;
};

export async function serveTemporaryFile(
  request: Request,
  options: FileResponseOptions
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const match = matchFilePath(url.pathname);
  if (!match) return undefined;
  const { id } = match;
  if (!PAGE_ID_PATTERN.test(id)) return new Response(null, { status: 404 });

  const getNow = () => options.now?.() ?? new Date();
  const metadata = await options.storage.getTemporaryFile(id, {
    headOnly: true,
    signal: request.signal
  });
  if (!metadata || isExpired(metadata.expiresAt, getNow())) {
    metadata?.body.destroy();
    return new Response(null, { status: 404 });
  }
  metadata.body.destroy();

  let range = request.method === "HEAD" ? undefined : requestedRange(request);
  if (range === null) {
    return rangeNotSatisfiable(metadata.bytes);
  }

  const ifRange = range ? request.headers.get("if-range") : undefined;
  if (range && ifRange) {
    if (!ifRangeAllowsPartialResponse(ifRange, metadata.sha256, metadata.lastModified)) {
      range = undefined;
    }
  }

  const conditional = ["if-none-match", "if-modified-since", "if-match", "if-unmodified-since"]
    .some(name => request.headers.has(name));
  if (conditional) {
    const headers = new Headers({ "Cache-Control": "private, no-store", "Access-Control-Allow-Origin": "*" });
    applyRepresentationHeaders(headers, metadata.bytes, metadata.sha256, metadata.lastModified);
    if (preconditionFailed(request, headers)) {
      headers.set("Content-Length", "0");
      return new Response(null, { status: 412, headers });
    }
    if (isNotModified(request, headers)) return new Response(null, { status: 304, headers });
  }
  if (request.method === "GET" && !ifRange && !conditional && options.storage.presignTemporaryFile) {
    const delivery = fileDelivery(metadata, new URL(request.url).searchParams.get("download") === "1");
    const expiresInSeconds = metadata.expiresAt
      ? Math.min(DIRECT_VIDEO_URL_SECONDS,
          Math.floor((metadata.expiresAt.getTime() - getNow().getTime() - 1000) / 1000))
      : DIRECT_VIDEO_URL_SECONDS;
    if (expiresInSeconds >= 1) {
      let signedUrl: string | null = null;
      try {
        signedUrl = !delivery
          ? await options.storage.presignTemporaryFile(id, expiresInSeconds)
          : await options.storage.presignTemporaryFile(
              id, expiresInSeconds, delivery
            );
      } catch {
        // S3 signing is an optimization; the canonical file route can still stream.
      }
      if (signedUrl) {
        return new Response(null, {
          status: 307,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "private, no-store",
            "Location": signedUrl,
            "Referrer-Policy": "no-referrer",
            "X-Robots-Tag": "noindex, nofollow"
          }
        });
      }
    }
  }

  try {
    const file = request.method === "HEAD" ? metadata : await options.storage.getTemporaryFile(id, {
      range,
      signal: request.signal
    });
    if (!file || isExpired(file.expiresAt, getNow())) {
      file?.body.destroy();
      return new Response(null, { status: 404 });
    }

    const delivery = fileDelivery(file, new URL(request.url).searchParams.get("download") === "1");
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      // Artifact pages run sandboxed, so they reach this file across origins.
      // The URL is already the capability, and no credentials travel with it.
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "private, no-store",
      "Content-Disposition": contentDisposition(file.originalName, delivery?.kind ?? "attachment"),
      "Content-Type": delivery?.kind === "inline" ? "application/pdf" : normalizeMimeType(file.contentType),
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow"
    });
    applyRepresentationHeaders(headers, file.bytes, file.sha256, file.lastModified);
    if (file.contentRange) {
      headers.set("Content-Range", file.contentRange);
    }
    const status = file.contentRange ? 206 : 200;
    if (request.method === "HEAD") {
      return new Response(null, { status, headers });
    }
    return new Response(toWebStream(file.body), { status, headers });
  } catch (error) {
    if (error instanceof RangeNotSatisfiableError) {
      if (isExpired(error.expiresAt, getNow())) {
        return new Response(null, { status: 404 });
      }
      return rangeNotSatisfiable(error.totalBytes);
    }
    throw error;
  }
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

export function applyRepresentationHeaders(
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

export function isNotModified(request: Request, headers: Headers) {
  const etag = headers.get("ETag");
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch) {
    return ifNoneMatch.split(",").some(candidate => candidate.trim() === "*" ||
      Boolean(etag && candidate.trim().replace(/^W\//, "") === etag));
  }
  const lastModified = headers.get("Last-Modified");
  const ifModifiedSince = request.headers.get("if-modified-since");
  return Boolean(
    lastModified &&
      ifModifiedSince &&
      Date.parse(lastModified) <= Date.parse(ifModifiedSince)
  );
}

function preconditionFailed(request: Request, headers: Headers) {
  const ifMatch = request.headers.get("if-match");
  if (ifMatch) return !ifMatch.split(",").some(candidate => candidate.trim() === "*" || candidate.trim() === headers.get("etag"));
  const unmodified = request.headers.get("if-unmodified-since");
  const modified = headers.get("last-modified");
  return Boolean(unmodified && modified && Date.parse(modified) > Date.parse(unmodified));
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
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify({
    error: "range_not_satisfiable",
    message: "Only one satisfiable byte range is supported."
  }), { status: 416, headers });
}

function isExpired(expiresAt: Date | undefined, now: Date) {
  return Boolean(expiresAt && expiresAt <= now);
}

export function toWebStream(stream: Readable) {
  return Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
}

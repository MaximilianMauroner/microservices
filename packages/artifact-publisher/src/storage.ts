import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import {
  attachmentDisposition,
  originalNameMetadata,
  projectMetadata,
  readOriginalNameMetadata,
  readProjectMetadata
} from "./file-metadata.js";

const TEMPORARY_FILE_PREFIX = "files/";
const HTML_PREFIX = "pages/";
const PAGE_ID_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const LIST_METADATA_CONCURRENCY = 8;

export type StorageOperationOptions = {
  signal?: AbortSignal;
};

export type UploadListCursor = {
  version?: 1;
  criteria?: string;
  updatedAt: Date;
  key: string;
  originalName?: string;
  expiresAt?: Date;
};

export type UploadListSort = "newest" | "oldest" | "filename" | "expiry";
export type UploadExpiryFilter = "all" | "24h" | "7d" | "persistent";

export type ListUploadsOptions = StorageOperationOptions & {
  limit: number;
  kind?: StoredUploadSummary["kind"];
  q?: string;
  expiry?: UploadExpiryFilter;
  sort?: UploadListSort;
  criteria?: string;
  cursor?: UploadListCursor;
};

export type StoredUploadPage = {
  uploads: StoredUploadSummary[];
  nextCursor?: UploadListCursor;
};

export type PutHtmlOptions = StorageOperationOptions & {
  ifMatch?: string;
};

export type GetStoredObjectOptions = StorageOperationOptions & {
  headOnly?: boolean;
};

export type GetTemporaryFileOptions = GetStoredObjectOptions & {
  range?: string;
};

export type StoredHtml = {
  body: Readable;
  bytes: number;
  etag?: string;
  sha256?: string;
  lastModified?: Date;
  project?: string;
};

export type StoredTemporaryFile = {
  body: Readable;
  bytes: number;
  contentRange?: string;
  contentType: string;
  originalName: string;
  expiresAt: Date;
  sha256?: string;
  lastModified?: Date;
};

export type PutHtmlMetadata = {
  bytes: number;
  originalName: string;
  sha256: string;
  project?: string;
};

export type PutTemporaryFileMetadata = {
  bytes: number;
  originalName: string;
  sha256: string;
  contentType: string;
  expiresAt: Date;
};

export type StoredUploadSummary = {
  id: string;
  kind: "html" | "file";
  originalName: string;
  bytes: number;
  contentType: string;
  updatedAt: Date;
  expiresAt?: Date;
  project?: string;
};

export interface UploadStorage {
  putHtml(
    id: string,
    filePath: string,
    metadata: PutHtmlMetadata,
    options?: PutHtmlOptions
  ): Promise<void>;
  getHtml(id: string, options?: GetStoredObjectOptions): Promise<StoredHtml | null>;
  putTemporaryFile(
    id: string,
    filePath: string,
    metadata: PutTemporaryFileMetadata,
    options?: StorageOperationOptions
  ): Promise<void>;
  getTemporaryFile(
    id: string,
    options?: GetTemporaryFileOptions
  ): Promise<StoredTemporaryFile | null>;
  listUploads(
    asOf: Date,
    options: ListUploadsOptions
  ): Promise<StoredUploadPage>;
  updateHtmlProject(
    id: string,
    project: string,
    options?: StorageOperationOptions
  ): Promise<boolean>;
  deleteUpload(id: string, options?: StorageOperationOptions): Promise<void>;
  deleteExpiredTemporaryFiles(
    expiresAtOrBefore: Date,
    options?: StorageOperationOptions
  ): Promise<number>;
  close?(): void;
}

export type S3UploadStorageConfig = {
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
};

export class RangeNotSatisfiableError extends Error {
  constructor(
    readonly totalBytes?: number,
    readonly expiresAt?: Date
  ) {
    super("Requested byte range is not satisfiable");
    this.name = "RangeNotSatisfiableError";
  }
}

export class HtmlUpdateConflictError extends Error {
  constructor() {
    super("The HTML page changed or was deleted before the update completed");
    this.name = "HtmlUpdateConflictError";
  }
}

export function createS3UploadStorage(config: S3UploadStorageConfig): UploadStorage {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    // Optional streaming checksums use the AWS-specific `aws-chunked`
    // encoding, which is not implemented consistently by S3-compatible
    // providers. The publisher already computes and stores SHA-256 metadata.
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });

  return {
    async putHtml(id, filePath, metadata, options) {
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: htmlKey(id),
            Body: createReadStream(filePath, { signal: options?.signal }),
            CacheControl: "private, no-cache",
            ContentLength: metadata.bytes,
            ContentType: "text/html; charset=utf-8",
            IfMatch: options?.ifMatch,
            Metadata: {
              ...originalNameMetadata(metadata.originalName),
              ...projectMetadata(metadata.project),
              bytes: String(metadata.bytes),
              sha256: metadata.sha256
            }
          }),
          requestOptions(options)
        );
      } catch (error) {
        if (options?.ifMatch && isConditionalWriteConflictError(error)) {
          throw new HtmlUpdateConflictError();
        }
        throw error;
      }
    },

    async getHtml(id, options) {
      try {
        if (options?.headOnly) {
          const result = await client.send(
            new HeadObjectCommand({
              Bucket: config.bucket,
              Key: htmlKey(id)
            }),
            requestOptions(options)
          );
          const project = readProjectMetadata(result.Metadata ?? {});

          return {
            body: Readable.from(Buffer.alloc(0)),
            bytes: result.ContentLength ?? 0,
            etag: result.ETag,
            sha256: result.Metadata?.sha256,
            lastModified: result.LastModified,
            ...(project ? { project } : {})
          };
        }

        const result = await client.send(
          new GetObjectCommand({
            Bucket: config.bucket,
            Key: htmlKey(id)
          }),
          requestOptions(options)
        );
        const project = readProjectMetadata(result.Metadata ?? {});

        return {
          body: await readableBody(result.Body),
          bytes: result.ContentLength ?? 0,
          etag: result.ETag,
          sha256: result.Metadata?.sha256,
          lastModified: result.LastModified,
          ...(project ? { project } : {})
        };
      } catch (error) {
        if (isNotFoundError(error)) {
          return null;
        }

        throw error;
      }
    },

    async putTemporaryFile(id, filePath, metadata, options) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: temporaryFileKey(id),
          Body: createReadStream(filePath, { signal: options?.signal }),
          CacheControl: "private, no-store",
          ContentDisposition: attachmentDisposition(metadata.originalName),
          ContentLength: metadata.bytes,
          ContentType: metadata.contentType,
          Expires: metadata.expiresAt,
          Metadata: {
            ...originalNameMetadata(metadata.originalName),
            bytes: String(metadata.bytes),
            "expires-at": metadata.expiresAt.toISOString(),
            sha256: metadata.sha256
          }
        }),
        requestOptions(options)
      );
    },

    async getTemporaryFile(id, options) {
      try {
        if (options?.headOnly) {
          const metadata = await headTemporaryFile(client, config.bucket, id, options);
          return metadata
            ? {
                body: Readable.from(Buffer.alloc(0)),
                ...metadata
              }
            : null;
        }

        const result = await client.send(
          new GetObjectCommand({
            Bucket: config.bucket,
            Key: temporaryFileKey(id),
            Range: options?.range
          }),
          requestOptions(options)
        );

        const metadata = result.Metadata ?? {};
        const expiresAt = parseMetadataDate(metadata["expires-at"]) ?? result.Expires;
        if (!expiresAt) {
          throw new Error(`Temporary file ${id} is missing expires-at metadata`);
        }

        return {
          body: await readableBody(result.Body),
          bytes: result.ContentLength ?? 0,
          contentRange: result.ContentRange,
          contentType: result.ContentType ?? "application/octet-stream",
          originalName: readOriginalNameMetadata(metadata, `${id}.bin`),
          expiresAt,
          sha256: metadata.sha256,
          lastModified: result.LastModified
        };
      } catch (error) {
        if (isNotFoundError(error)) {
          return null;
        }
        if (isRangeNotSatisfiableError(error)) {
          const metadata = await headTemporaryFile(client, config.bucket, id, options);
          if (!metadata) {
            return null;
          }
          throw new RangeNotSatisfiableError(
            readUnsatisfiedRangeLength(error) ?? metadata.bytes,
            metadata.expiresAt
          );
        }

        throw error;
      }
    },

    async listUploads(asOf, options) {
      const prefixes =
        options.kind === "html"
          ? ([[HTML_PREFIX, "html"]] as const)
          : options.kind === "file"
            ? ([[TEMPORARY_FILE_PREFIX, "file"]] as const)
            : ([
                [HTML_PREFIX, "html"],
                [TEMPORARY_FILE_PREFIX, "file"]
              ] as const);
      const candidates = (
        await Promise.all(
          prefixes.map(([prefix, kind]) =>
            listUploadCandidates(client, config.bucket, prefix, kind, options)
          )
        )
      )
        .flat();
      const sort = options.sort ?? "newest";
      if (!requiresFullMetadataScan(options)) {
        return listUploadsFast(
          client,
          config.bucket,
          candidates,
          asOf,
          options,
          sort === "oldest" ? "oldest" : "newest"
        );
      }
      const summaries = (await mapWithConcurrency(
        candidates,
        LIST_METADATA_CONCURRENCY,
        async (candidate) => {
          const summary = await headUploadSummary(client, config.bucket, candidate, asOf, options);
          return summary ? { ...summary, key: candidate.key } : null;
        }
      )).filter((summary): summary is ListedUploadSummary => summary !== null);
      const normalizedQuery = options.q?.trim().normalize("NFKC").toLowerCase() ?? "";
      const filtered = summaries
        .filter((upload) => !normalizedQuery || upload.originalName.normalize("NFKC").toLowerCase().includes(normalizedQuery))
        .filter((upload) => matchesExpiry(upload, options.expiry ?? "all", asOf))
        .sort(uploadComparator(sort));
      const listCursor = options.cursor;
      const afterCursor = listCursor
        ? filtered.filter((upload) => uploadComparator(sort)(upload, cursorUpload(listCursor)) > 0)
        : filtered;
      const page = afterCursor.slice(0, options.limit + 1);
      const uploads = page.slice(0, options.limit);
      const last = uploads.at(-1);
      return {
        uploads: uploads.map(({ key: _key, ...upload }) => upload),
        ...(last && page.length > options.limit
          ? {
              nextCursor: {
                version: 1,
                criteria: options.criteria ?? "legacy:newest",
                updatedAt: last.updatedAt,
                key: last.key,
                originalName: last.originalName,
                ...(last.expiresAt ? { expiresAt: last.expiresAt } : {})
              }
            }
          : {})
      };
    },

    async updateHtmlProject(id, project, options) {
      const key = htmlKey(id);
      try {
        const current = await client.send(
          new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
          requestOptions(options)
        );
        const metadata = { ...(current.Metadata ?? {}) };
        delete metadata["project-base64"];
        await client.send(
          new CopyObjectCommand({
            Bucket: config.bucket,
            Key: key,
            CopySource: `${config.bucket}/${key}`,
            CopySourceIfMatch: current.ETag,
            MetadataDirective: "REPLACE",
            Metadata: { ...metadata, ...projectMetadata(project) },
            CacheControl: current.CacheControl,
            ContentType: current.ContentType
          }),
          requestOptions(options)
        );
        return true;
      } catch (error) {
        if (isNotFoundError(error)) return false;
        if (isConditionalWriteConflictError(error)) throw new HtmlUpdateConflictError();
        throw error;
      }
    },

    async deleteUpload(id, options) {
      const errors: unknown[] = [];

      for (const key of [temporaryFileKey(id), htmlKey(id)]) {
        try {
          await client.send(
            new DeleteObjectCommand({
              Bucket: config.bucket,
              Key: key
            }),
            requestOptions(options)
          );
        } catch (error) {
          errors.push(error);
        }
      }

      if (errors.length > 0) {
        throw new AggregateError(errors, `Failed to delete upload ${id}`);
      }
    },

    async deleteExpiredTemporaryFiles(expiresAtOrBefore, options) {
      let deleted = 0;
      let continuationToken: string | undefined;

      do {
        const result = await client.send(
          new ListObjectsV2Command({
            Bucket: config.bucket,
            Prefix: TEMPORARY_FILE_PREFIX,
            ContinuationToken: continuationToken
          }),
          requestOptions(options)
        );

        for (const object of result.Contents ?? []) {
          if (!object.Key) {
            continue;
          }

          try {
            const expiresAt = await getObjectExpiry(client, config.bucket, object.Key, options);
            if (!expiresAt || expiresAt > expiresAtOrBefore) {
              continue;
            }

            await client.send(
              new DeleteObjectCommand({
                Bucket: config.bucket,
                Key: object.Key
              }),
              requestOptions(options)
            );
            deleted += 1;
          } catch (error) {
            console.error(`failed to clean up temporary upload ${object.Key}`, error);
          }
        }

        continuationToken = result.NextContinuationToken;
      } while (continuationToken);

      return deleted;
    },

    close() {
      client.destroy();
    }
  };
}

export function htmlKey(id: string) {
  return `${HTML_PREFIX}${id}.html`;
}

export function temporaryFileKey(id: string) {
  return `${TEMPORARY_FILE_PREFIX}${id}`;
}

type UploadCandidate = {
  id: string;
  kind: StoredUploadSummary["kind"];
  key: string;
  updatedAt: Date;
};

type ListedUploadSummary = StoredUploadSummary & { key: string };

function requiresFullMetadataScan(options: ListUploadsOptions): boolean {
  const sort = options.sort ?? "newest";
  return Boolean(options.q) ||
    (options.expiry ?? "all") !== "all" ||
    sort === "filename" ||
    sort === "expiry";
}

async function listUploadsFast(
  client: S3Client,
  bucket: string,
  candidates: UploadCandidate[],
  asOf: Date,
  options: ListUploadsOptions,
  sort: "newest" | "oldest"
): Promise<StoredUploadPage> {
  const ordered = [...candidates]
    .sort((left, right) => compareCandidates(left, right, sort))
    .filter((candidate) => !options.cursor || candidateAfterCursor(candidate, options.cursor, sort));
  const uploads: ListedUploadSummary[] = [];
  let processed = 0;
  while (processed < ordered.length && uploads.length <= options.limit) {
    const chunk = ordered.slice(processed, processed + LIST_METADATA_CONCURRENCY);
    const summaries = await mapWithConcurrency(
      chunk,
      LIST_METADATA_CONCURRENCY,
      async (candidate) => {
        const summary = await headUploadSummary(client, bucket, candidate, asOf, options);
        return summary
          ? { ...summary, updatedAt: candidate.updatedAt, key: candidate.key }
          : null;
      }
    );
    processed += chunk.length;
    uploads.push(...summaries.filter((summary): summary is ListedUploadSummary => summary !== null));
  }
  const page = uploads.slice(0, options.limit);
  const last = page.at(-1);
  return {
    uploads: page.map(({ key: _key, ...upload }) => upload),
    ...(last && uploads.length > options.limit
      ? {
          nextCursor: {
            version: 1,
            criteria: options.criteria ?? "legacy:newest",
            updatedAt: last.updatedAt,
            key: last.key,
            originalName: last.originalName,
            ...(last.expiresAt ? { expiresAt: last.expiresAt } : {})
          }
        }
      : {})
  };
}

function compareCandidates(
  left: UploadCandidate,
  right: UploadCandidate,
  sort: "newest" | "oldest"
): number {
  const time = left.updatedAt.getTime() - right.updatedAt.getTime();
  return (sort === "oldest" ? time : -time) || left.key.localeCompare(right.key);
}

function candidateAfterCursor(
  candidate: UploadCandidate,
  cursor: UploadListCursor,
  sort: "newest" | "oldest"
): boolean {
  const time = candidate.updatedAt.getTime() - cursor.updatedAt.getTime();
  return sort === "oldest"
    ? time > 0 || (time === 0 && candidate.key > cursor.key)
    : time < 0 || (time === 0 && candidate.key > cursor.key);
}

async function listUploadCandidates(
  client: S3Client,
  bucket: string,
  prefix: string,
  kind: StoredUploadSummary["kind"],
  options?: StorageOperationOptions
) {
  const candidates: UploadCandidate[] = [];
  let continuationToken: string | undefined;

  do {
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken
      }),
      requestOptions(options)
    );

    for (const object of result.Contents ?? []) {
      if (!object.Key || !object.LastModified) {
        continue;
      }
      const id = uploadIdFromKey(object.Key, kind);
      if (!id) {
        continue;
      }
      candidates.push({
        id,
        key: object.Key,
        kind,
        updatedAt: object.LastModified
      });
    }
    continuationToken = result.NextContinuationToken;
  } while (continuationToken);

  return candidates;
}

function uploadComparator(sort: UploadListSort) {
  return (left: ListedUploadSummary, right: ListedUploadSummary): number => {
    if (sort === "oldest") {
      return left.updatedAt.getTime() - right.updatedAt.getTime() || left.key.localeCompare(right.key);
    }
    if (sort === "filename") {
      return left.originalName.localeCompare(right.originalName, undefined, { sensitivity: "base" }) || left.key.localeCompare(right.key);
    }
    if (sort === "expiry") {
      return (left.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY) - (right.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY) || left.key.localeCompare(right.key);
    }
    return right.updatedAt.getTime() - left.updatedAt.getTime() || left.key.localeCompare(right.key);
  };
}

function cursorUpload(cursor: UploadListCursor): ListedUploadSummary {
  return {
    id: "cursor",
    key: cursor.key,
    kind: cursor.key.startsWith(HTML_PREFIX) ? "html" : "file",
    originalName: cursor.originalName ?? cursor.key,
    bytes: 0,
    contentType: "application/octet-stream",
    updatedAt: cursor.updatedAt,
    ...(cursor.expiresAt ? { expiresAt: cursor.expiresAt } : {})
  };
}

function matchesExpiry(upload: ListedUploadSummary, filter: UploadExpiryFilter, asOf: Date): boolean {
  if (filter === "all") return true;
  if (filter === "persistent") return upload.kind === "html";
  if (!upload.expiresAt) return false;
  const windowMs = filter === "24h" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  return upload.expiresAt.getTime() <= asOf.getTime() + windowMs;
}

async function headUploadSummary(
  client: S3Client,
  bucket: string,
  candidate: UploadCandidate,
  asOf: Date,
  options?: StorageOperationOptions
): Promise<StoredUploadSummary | null> {
  try {
    const result = await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: candidate.key
      }),
      requestOptions(options)
    );
    const metadata = result.Metadata ?? {};
    const updatedAt = result.LastModified ?? candidate.updatedAt;

    if (candidate.kind === "html") {
      const project = readProjectMetadata(metadata);
      return {
        id: candidate.id,
        kind: "html",
        originalName: readOriginalNameMetadata(
          metadata,
          `${candidate.id}.html`
        ),
        bytes: result.ContentLength ?? 0,
        contentType: result.ContentType ?? "text/html; charset=utf-8",
        updatedAt,
        ...(project ? { project } : {})
      };
    }

    const expiresAt =
      parseMetadataDate(metadata["expires-at"]) ?? result.Expires;
    if (!expiresAt || expiresAt <= asOf) {
      return null;
    }
    return {
      id: candidate.id,
      kind: "file",
      originalName: readOriginalNameMetadata(metadata, `${candidate.id}.bin`),
      bytes: result.ContentLength ?? 0,
      contentType: result.ContentType ?? "application/octet-stream",
      updatedAt,
      expiresAt
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

function uploadIdFromKey(
  key: string,
  kind: StoredUploadSummary["kind"]
) {
  const value =
    kind === "html"
      ? key.startsWith(HTML_PREFIX) && key.endsWith(".html")
        ? key.slice(HTML_PREFIX.length, -".html".length)
        : ""
      : key.startsWith(TEMPORARY_FILE_PREFIX)
        ? key.slice(TEMPORARY_FILE_PREFIX.length)
        : "";
  return PAGE_ID_PATTERN.test(value) ? value : null;
}

async function mapWithConcurrency<T, Result>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<Result>
) {
  const results = new Array<Result>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(values[index]);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

async function getObjectExpiry(
  client: S3Client,
  bucket: string,
  key: string,
  options?: StorageOperationOptions
) {
  try {
    const result = await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key
      }),
      requestOptions(options)
    );

    return parseMetadataDate(result.Metadata?.["expires-at"]) ?? result.Expires ?? null;
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }

    throw error;
  }
}

async function headTemporaryFile(
  client: S3Client,
  bucket: string,
  id: string,
  options?: StorageOperationOptions
): Promise<Omit<StoredTemporaryFile, "body" | "contentRange"> | null> {
  try {
    const result = await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: temporaryFileKey(id)
      }),
      requestOptions(options)
    );
    const metadata = result.Metadata ?? {};
    const expiresAt = parseMetadataDate(metadata["expires-at"]) ?? result.Expires;
    if (!expiresAt) {
      throw new Error(`Temporary file ${id} is missing expires-at metadata`);
    }

    return {
      bytes: result.ContentLength ?? 0,
      contentType: result.ContentType ?? "application/octet-stream",
      originalName: readOriginalNameMetadata(metadata, `${id}.bin`),
      expiresAt,
      sha256: metadata.sha256,
      lastModified: result.LastModified
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }

    throw error;
  }
}

async function readableBody(body: GetObjectCommandOutput["Body"]) {
  if (!body) {
    return Readable.from(Buffer.alloc(0));
  }

  if (body instanceof Readable) {
    return body;
  }

  if (typeof body.transformToWebStream === "function") {
    const webStream = body.transformToWebStream() as unknown as NodeReadableStream<Uint8Array>;
    return Readable.fromWeb(webStream);
  }

  throw new Error("Unsupported S3 response body");
}

function requestOptions(options?: StorageOperationOptions) {
  return options?.signal ? { abortSignal: options.signal } : undefined;
}

function parseMetadataDate(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isNotFoundError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

function isConditionalWriteConflictError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    candidate.name === "PreconditionFailed" ||
    candidate.name === "ConditionalRequestConflict" ||
    candidate.$metadata?.httpStatusCode === 409 ||
    candidate.$metadata?.httpStatusCode === 412
  );
}

function isRangeNotSatisfiableError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.name === "InvalidRange" || candidate.$metadata?.httpStatusCode === 416;
}

function readUnsatisfiedRangeLength(error: unknown) {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const candidate = error as {
    $response?: { headers?: Record<string, string | undefined> };
  };
  const contentRange = candidate.$response?.headers?.["content-range"];
  const match = contentRange?.match(/^bytes \*\/(\d+)$/i);
  if (!match) {
    return undefined;
  }

  const bytes = Number(match[1]);
  return Number.isSafeInteger(bytes) ? bytes : undefined;
}

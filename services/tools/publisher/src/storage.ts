import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import {
  CopyObjectCommand,
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListMultipartUploadsCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { DirectUploads } from "./direct-uploads.js";
import {
  contentDisposition,
  type FileDelivery,
  originalNameMetadata,
  projectMetadata,
  readOriginalNameMetadata,
  readProjectMetadata
} from "./file-metadata.js";

import {
  type UploadCategory,
  type UploadListCriteria
} from "./upload-list.js";

export type { UploadListCriteria, UploadListSort, UploadExpiryFilter } from "./upload-list.js";

const TEMPORARY_FILE_PREFIX = "files/";
const HTML_PREFIX = "pages/";

export type StorageOperationOptions = {
  signal?: AbortSignal;
  objectKey?: string;
};

export type UploadListCursor = {
  version?: 1;
  criteria?: string;
  updatedAt: Date;
  key: string;
  originalName?: string;
  bytes?: number;
  expiresAt?: Date;
};

export type ListUploadsOptions = StorageOperationOptions & {
  limit: number;
  includeSummary?: boolean;
  criteria?: UploadListCriteria;
  cursor?: UploadListCursor;
};

export type StoredUploadPage = {
  uploads: Array<StoredUploadSummary & { category: UploadCategory }>;
  nextCursor?: UploadListCursor;
  summary?: StoredUploadInventorySummary;
};

export type StoredUploadInventorySummary = {
  total: number;
  activeBytes: number;
  permanent: number;
  temporary: number;
  expiringSoon: number;
  projects: Array<{ project: string | null; count: number }>;
};

export type PutHtmlOptions = StorageOperationOptions & {
  ifMatch?: string;
  expectedObjectKey?: string;
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
  version?: string;
};

export type StoredTemporaryFile = {
  body: Readable;
  bytes: number;
  contentRange?: string;
  contentType: string;
  originalName: string;
  expiresAt?: Date;
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
  uploadLinkId?: string;
};

export class UploadLinkInactiveError extends Error {
  constructor() {
    super("This upload link has expired or was revoked.");
    this.name = "UploadLinkInactiveError";
  }
}

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
  directUploads?: DirectUploads;
  uploadOrigins?: readonly string[];
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
  /** Optional direct delivery for backends with short-lived signed reads. */
  presignTemporaryFile?(
    id: string,
    expiresInSeconds: number,
    delivery?: FileDelivery,
    options?: StorageOperationOptions
  ): Promise<string | null>;
  listUploads(
    asOf: Date,
    options: ListUploadsOptions
  ): Promise<StoredUploadPage>;
  updateHtmlProject(
    id: string,
    project: string,
    options?: StorageOperationOptions
  ): Promise<boolean>;
  updateFileExpiry(
    id: string,
    expiresAt: Date | null,
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

export class FileUpdateConflictError extends Error {
  constructor() {
    super("The file changed or was deleted before the expiry update completed");
    this.name = "FileUpdateConflictError";
  }
}

export type UploadBodyStorage = Omit<UploadStorage,
  "directUploads" | "uploadOrigins" | "listUploads" | "updateHtmlProject" | "deleteExpiredTemporaryFiles"
>;

export function createS3BodyStorage(config: S3UploadStorageConfig): UploadBodyStorage {
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
            Key: options?.objectKey ?? htmlKey(id),
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
              Key: options?.objectKey ?? htmlKey(id)
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
            Key: options?.objectKey ?? htmlKey(id)
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
          ContentDisposition: contentDisposition(metadata.originalName),
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
            Key: options?.objectKey ?? temporaryFileKey(id),
            Range: options?.range
          }),
          requestOptions(options)
        );

        const metadata = result.Metadata ?? {};
        const expiresAt = parseMetadataDate(metadata["expires-at"]) ?? result.Expires;

        return {
          body: await readableBody(result.Body),
          bytes: result.ContentLength ?? 0,
          contentRange: result.ContentRange,
          contentType: result.ContentType ?? "application/octet-stream",
          originalName: readOriginalNameMetadata(metadata, `${id}.bin`),
          ...(expiresAt ? { expiresAt } : {}),
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

    async presignTemporaryFile(id, expiresInSeconds, delivery, options) {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: options?.objectKey ?? temporaryFileKey(id),
          ...(delivery ? {
            ResponseContentDisposition: contentDisposition(delivery.filename, delivery.kind),
            ResponseContentType: delivery.kind === "inline" ? "application/pdf" : "application/octet-stream",
            ResponseCacheControl: "private, no-store"
          } : {})
        }),
        { expiresIn: expiresInSeconds }
      );
    },

    async updateFileExpiry(id, expiresAt, options) {
      const key = options?.objectKey ?? temporaryFileKey(id);
      try {
        const current = await client.send(
          new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
          requestOptions(options)
        );
        const metadata = { ...(current.Metadata ?? {}) };
        if (expiresAt) metadata["expires-at"] = expiresAt.toISOString();
        else delete metadata["expires-at"];
        await client.send(
          new CopyObjectCommand({
            Bucket: config.bucket,
            Key: key,
            CopySource: `${config.bucket}/${key}`,
            CopySourceIfMatch: current.ETag,
            MetadataDirective: "REPLACE",
            Metadata: metadata,
            CacheControl: current.CacheControl,
            ContentDisposition: current.ContentDisposition,
            ContentType: current.ContentType,
            ...(expiresAt ? { Expires: expiresAt } : {})
          }),
          requestOptions(options)
        );
        return true;
      } catch (error) {
        if (isNotFoundError(error)) return false;
        if (isConditionalWriteConflictError(error)) throw new FileUpdateConflictError();
        throw error;
      }
    },

    async deleteUpload(id, options) {
      const errors: unknown[] = [];
      const keys = options?.objectKey ? [options.objectKey] : [temporaryFileKey(id), htmlKey(id), `transfers/${id}`];
      if (!options?.objectKey) try {
        const prefix = `transfers/${id}/`;
        let marker: string | undefined;
        let uploadMarker: string | undefined;
        do {
          const uploads = await client.send(new ListMultipartUploadsCommand({ Bucket: config.bucket,
            Prefix: prefix, KeyMarker: marker, UploadIdMarker: uploadMarker }), requestOptions(options));
          for (const upload of uploads.Uploads ?? []) {
            if (upload.Key?.startsWith(prefix) && upload.UploadId) await client.send(new AbortMultipartUploadCommand({
              Bucket: config.bucket, Key: upload.Key, UploadId: upload.UploadId
            }), requestOptions(options));
          }
          marker = uploads.IsTruncated ? uploads.NextKeyMarker : undefined;
          uploadMarker = uploads.IsTruncated ? uploads.NextUploadIdMarker : undefined;
        } while (marker);
        let continuation: string | undefined;
        do {
          const objects = await client.send(new ListObjectsV2Command({ Bucket: config.bucket,
            Prefix: prefix, ContinuationToken: continuation }), requestOptions(options));
          for (const object of objects.Contents ?? []) if (object.Key?.startsWith(prefix)) keys.push(object.Key);
          continuation = objects.IsTruncated ? objects.NextContinuationToken : undefined;
        } while (continuation);
      } catch (error) { errors.push(error); }
      for (const key of keys) {
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

export function matchesUploadProject(project: string | undefined, filter: UploadListCriteria["project"]): boolean {
  return filter.mode === "all" || (filter.mode === "unassigned" ? !project : project === filter.name);
}

export function summarizeUploads(
  uploads: Array<StoredUploadSummary>,
  asOf: Date
): StoredUploadInventorySummary {
  const active = uploads.filter((upload) => !upload.expiresAt || upload.expiresAt > asOf);
  const projectCounts = new Map<string | null, number>();
  for (const upload of active) {
    const project = upload.project ?? null;
    projectCounts.set(project, (projectCounts.get(project) ?? 0) + 1);
  }
  return {
    total: active.length,
    activeBytes: active.reduce((total, upload) => total + upload.bytes, 0),
    permanent: active.filter((upload) => !upload.expiresAt).length,
    temporary: active.filter((upload) => Boolean(upload.expiresAt)).length,
    expiringSoon: active.filter((upload) => upload.expiresAt && upload.expiresAt <= new Date(asOf.getTime() + 86_400_000)).length,
    projects: [...projectCounts].map(([project, count]) => ({ project, count }))
  };
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
        Key: options?.objectKey ?? temporaryFileKey(id)
      }),
      requestOptions(options)
    );
    const metadata = result.Metadata ?? {};
    const expiresAt = parseMetadataDate(metadata["expires-at"]) ?? result.Expires;

    return {
      bytes: result.ContentLength ?? 0,
      contentType: result.ContentType ?? "application/octet-stream",
      originalName: readOriginalNameMetadata(metadata, `${id}.bin`),
      ...(expiresAt ? { expiresAt } : {}),
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

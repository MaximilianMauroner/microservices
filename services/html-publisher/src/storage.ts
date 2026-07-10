import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import {
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
  readOriginalNameMetadata
} from "./file-metadata.js";

const TEMPORARY_FILE_PREFIX = "files/";

export type StorageOperationOptions = {
  signal?: AbortSignal;
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
  sha256?: string;
  lastModified?: Date;
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
};

export type PutTemporaryFileMetadata = {
  bytes: number;
  originalName: string;
  sha256: string;
  contentType: string;
  expiresAt: Date;
};

export interface UploadStorage {
  putHtml(
    id: string,
    filePath: string,
    metadata: PutHtmlMetadata,
    options?: StorageOperationOptions
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

export function createS3UploadStorage(config: S3UploadStorageConfig): UploadStorage {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });

  return {
    async putHtml(id, filePath, metadata, options) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: htmlKey(id),
          Body: createReadStream(filePath, { signal: options?.signal }),
          CacheControl: "private, no-cache",
          ContentLength: metadata.bytes,
          ContentType: "text/html; charset=utf-8",
          Metadata: {
            ...originalNameMetadata(metadata.originalName),
            bytes: String(metadata.bytes),
            sha256: metadata.sha256
          }
        }),
        requestOptions(options)
      );
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

          return {
            body: Readable.from(Buffer.alloc(0)),
            bytes: result.ContentLength ?? 0,
            sha256: result.Metadata?.sha256,
            lastModified: result.LastModified
          };
        }

        const result = await client.send(
          new GetObjectCommand({
            Bucket: config.bucket,
            Key: htmlKey(id)
          }),
          requestOptions(options)
        );

        return {
          body: await readableBody(result.Body),
          bytes: result.ContentLength ?? 0,
          sha256: result.Metadata?.sha256,
          lastModified: result.LastModified
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
  return `pages/${id}.html`;
}

export function temporaryFileKey(id: string) {
  return `${TEMPORARY_FILE_PREFIX}${id}`;
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

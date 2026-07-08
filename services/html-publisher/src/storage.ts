import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";

const TEMPORARY_FILE_PREFIX = "files/";

export type StoredHtml = {
  body: Buffer;
};

export type StoredTemporaryFile = {
  body: Readable;
  contentType: string;
  originalName: string;
  expiresAt: Date;
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
  putHtml(id: string, filePath: string, metadata: PutHtmlMetadata): Promise<void>;
  getHtml(id: string): Promise<StoredHtml | null>;
  putTemporaryFile(
    id: string,
    filePath: string,
    metadata: PutTemporaryFileMetadata
  ): Promise<void>;
  getTemporaryFile(id: string): Promise<StoredTemporaryFile | null>;
  deleteExpiredTemporaryFiles(cutoff: Date): Promise<number>;
}

export type S3UploadStorageConfig = {
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
};

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
    async putHtml(id, filePath, metadata) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: htmlKey(id),
          Body: createReadStream(filePath),
          ContentLength: metadata.bytes,
          ContentType: "text/html; charset=utf-8",
          Metadata: {
            "original-name": metadata.originalName,
            sha256: metadata.sha256
          }
        })
      );
    },

    async getHtml(id) {
      try {
        const result = await client.send(
          new GetObjectCommand({
            Bucket: config.bucket,
            Key: htmlKey(id)
          })
        );

        return {
          body: await readBody(result.Body)
        };
      } catch (error) {
        if (isNotFoundError(error)) {
          return null;
        }

        throw error;
      }
    },

    async putTemporaryFile(id, filePath, metadata) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: temporaryFileKey(id),
          Body: createReadStream(filePath),
          ContentDisposition: attachmentDisposition(metadata.originalName),
          ContentLength: metadata.bytes,
          ContentType: metadata.contentType,
          Metadata: {
            "expires-at": metadata.expiresAt.toISOString(),
            "original-name": metadata.originalName,
            sha256: metadata.sha256
          }
        })
      );
    },

    async getTemporaryFile(id) {
      try {
        const result = await client.send(
          new GetObjectCommand({
            Bucket: config.bucket,
            Key: temporaryFileKey(id)
          })
        );

        const metadata = result.Metadata ?? {};
        const expiresAt = parseMetadataDate(metadata["expires-at"]);
        if (!expiresAt) {
          throw new Error(`Temporary file ${id} is missing expires-at metadata`);
        }

        return {
          body: await readableBody(result.Body),
          contentType: result.ContentType ?? "application/octet-stream",
          originalName: metadata["original-name"] ?? `${id}.bin`,
          expiresAt
        };
      } catch (error) {
        if (isNotFoundError(error)) {
          return null;
        }

        throw error;
      }
    },

    async deleteExpiredTemporaryFiles(cutoff) {
      let deleted = 0;
      let continuationToken: string | undefined;

      do {
        const result = await client.send(
          new ListObjectsV2Command({
            Bucket: config.bucket,
            Prefix: TEMPORARY_FILE_PREFIX,
            ContinuationToken: continuationToken
          })
        );

        for (const object of result.Contents ?? []) {
          if (!object.Key || !object.LastModified || object.LastModified > cutoff) {
            continue;
          }

          await client.send(
            new DeleteObjectCommand({
              Bucket: config.bucket,
              Key: object.Key
            })
          );
          deleted += 1;
        }

        continuationToken = result.NextContinuationToken;
      } while (continuationToken);

      return deleted;
    }
  };
}

export function htmlKey(id: string) {
  return `pages/${id}.html`;
}

export function temporaryFileKey(id: string) {
  return `${TEMPORARY_FILE_PREFIX}${id}`;
}

async function readBody(body: GetObjectCommandOutput["Body"]) {
  if (!body) {
    return Buffer.alloc(0);
  }

  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  if (typeof body.transformToByteArray === "function") {
    return Buffer.from(await body.transformToByteArray());
  }

  throw new Error("Unsupported S3 response body");
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

  if (typeof body.transformToByteArray === "function") {
    return Readable.from(Buffer.from(await body.transformToByteArray()));
  }

  throw new Error("Unsupported S3 response body");
}

function parseMetadataDate(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function attachmentDisposition(originalName: string) {
  const fallbackName = originalName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${fallbackName}"`;
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

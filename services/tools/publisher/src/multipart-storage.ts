import crypto from "node:crypto";
import { Readable } from "node:stream";
import {
  AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand,
  DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListMultipartUploadsCommand,
  ListPartsCommand, S3Client, UploadPartCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { contentDisposition, originalNameMetadata, projectMetadata } from "./file-metadata.js";
import type { S3UploadStorageConfig } from "./storage.js";

export type DirectUploadDescription = {
  kind: "html" | "file";
  filename: string;
  contentType: string;
  totalBytes: number;
  partBytes: number;
  project?: string;
  fileExpiresAt?: string;
  retentionMs?: number;
};
export type UploadPartDigest = { number: number; sha256: string };
export type BucketPart = { number: number; bytes: number; etag: string };
export type VerifiedPart = BucketPart & { sha256: string };

export class DirectUploadError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "DirectUploadError";
  }
}

export function partCount(description: DirectUploadDescription) {
  return Math.max(1, Math.ceil(description.totalBytes / description.partBytes));
}

export function partSize(description: DirectUploadDescription, number: number) {
  return Math.min(description.partBytes, description.totalBytes - (number - 1) * description.partBytes);
}

export function createMultipartStorage(config: S3UploadStorageConfig) {
  const client = new S3Client({ endpoint: config.endpoint, region: config.region, forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED", maxAttempts: 3 });
  const address = (key: string) => ({ Bucket: config.bucket, Key: key });
  return {
    async create(key: string, description: DirectUploadDescription, signal: AbortSignal) {
      const result = await client.send(new CreateMultipartUploadCommand({
        ...address(key), ContentType: description.contentType,
        CacheControl: description.kind === "html" ? "private, no-cache" : "private, no-store",
        ...(description.kind === "file" ? { ContentDisposition: contentDisposition(description.filename) } : {}),
        Metadata: { ...originalNameMetadata(description.filename), ...projectMetadata(description.project),
          ...(description.fileExpiresAt ? { "expires-at": description.fileExpiresAt } : {}) }
      }), { abortSignal: signal });
      if (!result.UploadId) throw new Error("Storage did not return a multipart upload ID");
      return result.UploadId;
    },
    async sign(key: string, uploadId: string, number: number, bytes: number, seconds: number) {
      // Browsers set Content-Length from the Blob. Include it in the signature so
      // a capability cannot authorize a larger part. No storage credentials leave Tools.
      return getSignedUrl(client, new UploadPartCommand({ ...address(key), UploadId: uploadId,
        PartNumber: number, ContentLength: bytes }),
      { expiresIn: seconds, signableHeaders: new Set(["content-length"]) });
    },
    async parts(key: string, uploadId: string, signal: AbortSignal): Promise<BucketPart[]> {
      const result = await client.send(new ListPartsCommand({ ...address(key), UploadId: uploadId,
        MaxParts: 251 }), { abortSignal: signal });
      if (result.IsTruncated || (result.Parts?.length ?? 0) > 250) {
        throw new DirectUploadError(400, "invalid_parts", "The upload has too many parts.");
      }
      return (result.Parts ?? []).map(part => {
        if (!part.PartNumber || part.Size === undefined || !part.ETag) throw new Error("Invalid storage part response");
        return { number: part.PartNumber, bytes: part.Size, etag: part.ETag };
      });
    },
    async complete(key: string, uploadId: string, parts: VerifiedPart[], signal: AbortSignal) {
      await client.send(new CompleteMultipartUploadCommand({ ...address(key), UploadId: uploadId,
        MultipartUpload: { Parts: parts.map(part => ({ PartNumber: part.number, ETag: part.etag })) }
      }), { abortSignal: signal });
    },
    async exists(key: string, signal: AbortSignal) {
      try {
        const result = await client.send(new HeadObjectCommand(address(key)), { abortSignal: signal });
        return result.ContentLength;
      } catch (error) {
        if (error instanceof Error && ["NotFound", "NoSuchKey"].includes(error.name)) return undefined;
        throw error;
      }
    },
    async verify(key: string, description: DirectUploadDescription, parts: VerifiedPart[], signal: AbortSignal) {
      const result = await client.send(new GetObjectCommand(address(key)), { abortSignal: signal });
      if (!(result.Body instanceof Readable)) throw new Error("Storage did not return a readable object");
      if (result.ContentLength !== description.totalBytes) {
        result.Body.destroy();
        throw new DirectUploadError(422, "size_mismatch", "Stored file size does not match the upload.");
      }
      return verifyStoredBytes(result.Body, description, parts, signal);
    },
    async remove(key: string, signal: AbortSignal) {
      // Listing by the durable, unique key also recovers CreateMultipartUpload
      // responses lost before the upload ID could be saved. Railway has no lifecycle rules.
      let keyMarker: string | undefined;
      let uploadIdMarker: string | undefined;
      do {
        const result = await client.send(new ListMultipartUploadsCommand({ Bucket: config.bucket,
          Prefix: key, KeyMarker: keyMarker, UploadIdMarker: uploadIdMarker, MaxUploads: 100
        }), { abortSignal: signal });
        for (const upload of result.Uploads ?? []) {
          if (upload.Key === key && upload.UploadId) await client.send(new AbortMultipartUploadCommand({
            ...address(key), UploadId: upload.UploadId }), { abortSignal: signal });
        }
        keyMarker = result.IsTruncated ? result.NextKeyMarker : undefined;
        uploadIdMarker = result.IsTruncated ? result.NextUploadIdMarker : undefined;
      } while (keyMarker);
      await client.send(new DeleteObjectCommand(address(key)), { abortSignal: signal });
    },
    close: () => client.destroy()
  };
}

/** Validate actual bytes with bounded buffers. Part digests are expectations,
 * never proof. Neither user metadata nor multipart ETags are treated as SHA-256. */
export async function verifyStoredBytes(body: Readable, description: DirectUploadDescription,
  parts: VerifiedPart[], signal: AbortSignal) {
  const whole = crypto.createHash("sha256");
  let partHash = crypto.createHash("sha256");
  let number = 1;
  let received = 0;
  let partReceived = 0;
  try {
    for await (const value of body) {
      signal.throwIfAborted();
      if (!(value instanceof Uint8Array)) throw new Error("Storage returned non-byte data");
      received += value.byteLength;
      if (received > description.totalBytes) throw new DirectUploadError(422, "size_mismatch", "Stored file is too large.");
      whole.update(value);
      let offset = 0;
      while (offset < value.byteLength) {
        const length = Math.min(partSize(description, number) - partReceived, value.byteLength - offset);
        partHash.update(value.subarray(offset, offset + length));
        partReceived += length;
        offset += length;
        if (partReceived !== partSize(description, number)) continue;
        if (partHash.digest("hex") !== parts[number - 1]?.sha256) {
          throw new DirectUploadError(422, "checksum_mismatch", "Stored bytes do not match the upload checksum.");
        }
        number += 1;
        partReceived = 0;
        partHash = crypto.createHash("sha256");
      }
    }
    if (received !== description.totalBytes) throw new DirectUploadError(422, "size_mismatch", "Stored file is incomplete.");
    if (received === 0 && partHash.digest("hex") !== parts[0]?.sha256) {
      throw new DirectUploadError(422, "checksum_mismatch", "Stored bytes do not match the upload checksum.");
    }
    return whole.digest("hex");
  } finally { body.destroy(); }
}

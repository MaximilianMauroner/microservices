import {
  GetObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { gunzipSync } from "node:zlib";

export interface BucketObject {
  body: unknown;
}

export interface JsonBucket {
  get(key: string): Promise<BucketObject | null>;
}

export class BucketReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BucketReadError";
  }
}

export function createS3JsonBucket(config: {
  endpoint: string;
  region: string;
  name: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}): JsonBucket {
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
    async get(key) {
      try {
        const result = await client.send(
          new GetObjectCommand({ Bucket: config.name, Key: key })
        );
        if (!result.Body) throw new BucketReadError("Bucket object has no body");
        const bytes = new Uint8Array(await result.Body.transformToByteArray());
        const decoded =
          result.ContentEncoding === "gzip" ? gunzipSync(bytes) : bytes;
        const text = new TextDecoder().decode(decoded);
        return {
          body: JSON.parse(text)
        };
      } catch (error) {
        if (isMissing(error)) return null;
        if (error instanceof BucketReadError) throw error;
        throw new BucketReadError("Unable to read bucket object");
      }
    }
  };
}

function errorName(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("name" in error)) {
    return undefined;
  }
  return typeof error.name === "string" ? error.name : undefined;
}

function isMissing(error: unknown): boolean {
  return ["NoSuchKey", "NotFound"].includes(errorName(error) ?? "");
}

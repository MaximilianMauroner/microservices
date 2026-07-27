import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";

export interface BucketObject {
  body: unknown;
  etag: string;
}

export interface ConditionalWrite {
  ifMatch?: string;
  ifNoneMatch?: "*";
}

export interface JsonBucket {
  get(key: string): Promise<BucketObject | null>;
  put(key: string, body: unknown, condition?: ConditionalWrite): Promise<string>;
  list(
    prefix: string,
    cursor: string | undefined,
    limit: number
  ): Promise<{ keys: string[]; nextCursor?: string }>;
}

export class BucketConflictError extends Error {
  constructor() {
    super("Object changed since it was read");
    this.name = "BucketConflictError";
  }
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
          result.ContentEncoding === "gzip" ? Bun.gunzipSync(bytes) : bytes;
        const text = new TextDecoder().decode(decoded);
        return {
          body: JSON.parse(text),
          etag: normalizeEtag(result.ETag)
        };
      } catch (error) {
        if (isMissing(error)) return null;
        if (error instanceof BucketReadError) throw error;
        throw new BucketReadError("Unable to read bucket object");
      }
    },
    async put(key, body, condition = {}) {
      try {
        const result = await client.send(
          new PutObjectCommand({
            Bucket: config.name,
            Key: key,
            Body: JSON.stringify(body),
            ContentType: "application/json",
            ...(condition.ifMatch ? { IfMatch: quoteEtag(condition.ifMatch) } : {}),
            ...(condition.ifNoneMatch
              ? { IfNoneMatch: condition.ifNoneMatch }
              : {})
          })
        );
        return normalizeEtag(result.ETag);
      } catch (error) {
        if (isConflict(error)) throw new BucketConflictError();
        throw new Error("Unable to write bucket object");
      }
    },
    async list(prefix, cursor, limit) {
      try {
        const result = await client.send(
          new ListObjectsV2Command({
            Bucket: config.name,
            Prefix: prefix,
            ContinuationToken: cursor,
            MaxKeys: limit
          })
        );
        const keys = (result.Contents ?? [])
          .map(({ Key }) => Key)
          .filter((key): key is string => key !== undefined);
        return {
          keys,
          ...(result.NextContinuationToken
            ? { nextCursor: result.NextContinuationToken }
            : {})
        };
      } catch {
        throw new BucketReadError("Unable to list bucket objects");
      }
    }
  };
}

function normalizeEtag(etag: string | undefined): string {
  if (!etag) throw new BucketReadError("Bucket response omitted ETag");
  return etag.replace(/^"|"$/g, "");
}

function quoteEtag(etag: string): string {
  return `"${etag.replace(/^"|"$/g, "")}"`;
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

function isConflict(error: unknown): boolean {
  return ["PreconditionFailed", "ConditionalRequestConflict"].includes(
    errorName(error) ?? ""
  );
}

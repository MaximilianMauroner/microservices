import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import {
  BUCKET_KEYS,
  decodeCatalogDocument,
  decodeCheckerStateDocument,
  decodeHistoryPartitionDocument,
  decodePrivateSnapshotDocument,
  decodePublicSnapshotDocument,
  historyKey,
  recoveryKey,
  type CatalogDocument,
  type CheckerStateDocument,
  type HistoryPartitionDocument,
  type PrivateSnapshotDocument,
  type PublicSnapshotDocument
} from "@tools-platform/domain";
import type { CheckerConfig } from "./config.js";

export interface Versioned<Value> {
  value: Value;
  etag: string;
}

export interface CheckerStore {
  readCatalog(signal?: AbortSignal): Promise<Versioned<CatalogDocument>>;
  readState(signal?: AbortSignal): Promise<Versioned<CheckerStateDocument> | null>;
  readHistory(
    day: string,
    signal?: AbortSignal
  ): Promise<Versioned<HistoryPartitionDocument> | null>;
  listHistoryDays(signal?: AbortSignal): Promise<string[]>;
  writeState(
    value: CheckerStateDocument,
    expectedEtag: string | null,
    signal?: AbortSignal
  ): Promise<string>;
  writeHistory(
    value: HistoryPartitionDocument,
    expectedEtag: string | null,
    signal?: AbortSignal
  ): Promise<string>;
  writePublicSnapshot(
    value: PublicSnapshotDocument,
    signal?: AbortSignal
  ): Promise<void>;
  writePrivateSnapshot(
    value: PrivateSnapshotDocument,
    signal?: AbortSignal
  ): Promise<void>;
  close(): void;
}

export class CheckerConflictError extends Error {
  constructor(public readonly key: string) {
    super(`Checker object changed since it was read: ${key}`);
    this.name = "CheckerConflictError";
  }
}

export function createS3CheckerStore(
  config: CheckerConfig["bucket"],
  now: () => Date = () => new Date()
): CheckerStore {
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
    async readCatalog(signal) {
      const object = await requiredObject(
        client,
        config.name,
        BUCKET_KEYS.catalog,
        signal
      );
      return decodeObject(object, BUCKET_KEYS.catalog, decodeCatalogDocument);
    },

    async readState(signal) {
      const object = await optionalObject(
        client,
        config.name,
        BUCKET_KEYS.checkerState,
        signal
      );
      return object
        ? decodeObject(
            object,
            BUCKET_KEYS.checkerState,
            decodeCheckerStateDocument
          )
        : null;
    },

    async readHistory(day, signal) {
      const key = historyKey(day);
      const object = await optionalObject(client, config.name, key, signal);
      return object
        ? decodeObject(object, key, decodeHistoryPartitionDocument)
        : null;
    },

    async listHistoryDays(signal) {
      const days: string[] = [];
      let continuationToken: string | undefined;
      do {
        const result = await client.send(
          new ListObjectsV2Command({
            Bucket: config.name,
            Prefix: "history/",
            ContinuationToken: continuationToken
          }),
          requestOptions(signal)
        );
        for (const object of result.Contents ?? []) {
          const match = object.Key?.match(
            /^history\/(\d{4}-\d{2}-\d{2})\.json\.gz$/
          );
          if (match) {
            days.push(match[1]);
          }
        }
        continuationToken = result.NextContinuationToken;
      } while (continuationToken);
      return [...new Set(days)].sort();
    },

    async writeState(value, expectedEtag, signal) {
      decodeCheckerStateDocument(value);
      return guardedWrite(
        client,
        config.name,
        BUCKET_KEYS.checkerState,
        encodeJson(value),
        "application/json",
        expectedEtag,
        now,
        undefined,
        signal
      );
    },

    async writeHistory(value, expectedEtag, signal) {
      decodeHistoryPartitionDocument(value);
      const bytes = Bun.gzipSync(encodeJson(value));
      return guardedWrite(
        client,
        config.name,
        historyKey(value.day),
        bytes,
        "application/json",
        expectedEtag,
        now,
        "gzip",
        signal
      );
    },

    async writePublicSnapshot(value, signal) {
      decodePublicSnapshotDocument(value);
      await ownedWrite(
        client,
        config.name,
        BUCKET_KEYS.publicSnapshot,
        encodeJson(value),
        "application/json",
        undefined,
        undefined,
        signal
      );
    },

    async writePrivateSnapshot(value, signal) {
      decodePrivateSnapshotDocument(value);
      await ownedWrite(
        client,
        config.name,
        BUCKET_KEYS.privateSnapshot,
        encodeJson(value),
        "application/json",
        undefined,
        undefined,
        signal
      );
    },

    close() {
      client.destroy();
    }
  };
}

interface BucketObject {
  bytes: Uint8Array;
  etag: string;
  encoding?: string;
}

async function requiredObject(
  client: S3Client,
  bucket: string,
  key: string,
  signal?: AbortSignal
): Promise<BucketObject> {
  const result = await optionalObject(client, bucket, key, signal);
  if (!result) {
    throw new Error(`Required bucket object is missing: ${key}`);
  }
  return result;
}

async function optionalObject(
  client: S3Client,
  bucket: string,
  key: string,
  signal?: AbortSignal
): Promise<BucketObject | null> {
  try {
    const result = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      requestOptions(signal)
    );
    if (!result.Body || !result.ETag) {
      throw new Error(`Bucket object is incomplete: ${key}`);
    }
    return {
      bytes: new Uint8Array(await result.Body.transformToByteArray()),
      etag: result.ETag,
      ...(result.ContentEncoding
        ? { encoding: result.ContentEncoding }
        : {})
    };
  } catch (error) {
    if (isMissing(error)) {
      return null;
    }
    throw error;
  }
}

function decodeObject<Value>(
  object: BucketObject,
  key: string,
  decoder: (input: unknown) => Value
): Versioned<Value> {
  let parsed: unknown;
  try {
    const bytes =
      object.encoding === "gzip"
        ? Bun.gunzipSync(new Uint8Array(object.bytes))
        : object.bytes;
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(`Bucket object contains invalid JSON: ${key}`);
  }
  try {
    return { value: decoder(parsed), etag: object.etag };
  } catch (error) {
    const message = error instanceof Error ? error.message : "decode failed";
    throw new Error(`Bucket object schema is invalid: ${key}: ${message}`);
  }
}

async function guardedWrite(
  client: S3Client,
  bucket: string,
  key: string,
  bytes: Uint8Array,
  contentType: string,
  expectedEtag: string | null,
  now: () => Date,
  contentEncoding?: string,
  signal?: AbortSignal
): Promise<string> {
  const previous = await optionalObject(client, bucket, key, signal);
  if (previous) {
    const stamp = now().toISOString().replaceAll(":", "-");
    await ownedWrite(
      client,
      bucket,
      recoveryKey(`${stamp}/${key}`),
      previous.bytes,
      "application/json",
      previous.encoding,
      undefined,
      signal
    );
  }
  const etag = await ownedWrite(
    client,
    bucket,
    key,
    bytes,
    contentType,
    contentEncoding,
    expectedEtag,
    signal
  );
  if (!etag) {
    throw new Error(`Bucket write did not return an ETag: ${key}`);
  }
  return etag;
}

async function ownedWrite(
  client: S3Client,
  bucket: string,
  key: string,
  bytes: Uint8Array,
  contentType: string,
  contentEncoding?: string,
  expectedEtag?: string | null,
  signal?: AbortSignal
): Promise<string> {
  assertCheckerOwnedKey(key);
  try {
    const result = await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        ...(contentEncoding ? { ContentEncoding: contentEncoding } : {}),
        ...(expectedEtag === null
          ? { IfNoneMatch: "*" }
          : expectedEtag
            ? { IfMatch: expectedEtag }
            : {})
      }),
      requestOptions(signal)
    );
    return result.ETag ?? "";
  } catch (error) {
    if (isConflict(error)) {
      throw new CheckerConflictError(key);
    }
    throw error;
  }
}

export function assertCheckerOwnedKey(key: string): void {
  if (
    key === BUCKET_KEYS.checkerState ||
    key === BUCKET_KEYS.publicSnapshot ||
    key === BUCKET_KEYS.privateSnapshot ||
    key.startsWith("history/") ||
    key.startsWith(BUCKET_KEYS.recoveryPrefix) ||
    key.startsWith(BUCKET_KEYS.exportPrefix)
  ) {
    return;
  }
  throw new Error(`Tools Checker cannot write bucket key: ${key}`);
}

function encodeJson(value: unknown): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(value));
}

function isMissing(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { name?: unknown; Code?: unknown };
  return (
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound" ||
    candidate.Code === "NoSuchKey"
  );
}

function isConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { name?: unknown; Code?: unknown };
  return (
    candidate.name === "PreconditionFailed" ||
    candidate.name === "ConditionalRequestConflict" ||
    candidate.Code === "PreconditionFailed"
  );
}

function requestOptions(
  signal: AbortSignal | undefined
): { abortSignal: AbortSignal } | undefined {
  return signal ? { abortSignal: signal } : undefined;
}

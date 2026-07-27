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
  readCatalog(): Promise<Versioned<CatalogDocument>>;
  readState(): Promise<Versioned<CheckerStateDocument> | null>;
  readHistory(day: string): Promise<Versioned<HistoryPartitionDocument> | null>;
  listHistoryDays(): Promise<string[]>;
  writeState(
    value: CheckerStateDocument,
    expectedEtag: string | null
  ): Promise<string>;
  writeHistory(
    value: HistoryPartitionDocument,
    expectedEtag: string | null
  ): Promise<string>;
  writePublicSnapshot(value: PublicSnapshotDocument): Promise<void>;
  writePrivateSnapshot(value: PrivateSnapshotDocument): Promise<void>;
  close(): void;
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
    async readCatalog() {
      const object = await requiredObject(
        client,
        config.name,
        BUCKET_KEYS.catalog
      );
      return decodeObject(object, BUCKET_KEYS.catalog, decodeCatalogDocument);
    },

    async readState() {
      const object = await optionalObject(
        client,
        config.name,
        BUCKET_KEYS.checkerState
      );
      return object
        ? decodeObject(
            object,
            BUCKET_KEYS.checkerState,
            decodeCheckerStateDocument
          )
        : null;
    },

    async readHistory(day) {
      const key = historyKey(day);
      const object = await optionalObject(client, config.name, key);
      return object
        ? decodeObject(object, key, decodeHistoryPartitionDocument)
        : null;
    },

    async listHistoryDays() {
      const days: string[] = [];
      let continuationToken: string | undefined;
      do {
        const result = await client.send(
          new ListObjectsV2Command({
            Bucket: config.name,
            Prefix: "history/",
            ContinuationToken: continuationToken
          })
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

    async writeState(value, expectedEtag) {
      decodeCheckerStateDocument(value);
      return guardedWrite(
        client,
        config.name,
        BUCKET_KEYS.checkerState,
        encodeJson(value),
        "application/json",
        expectedEtag,
        now
      );
    },

    async writeHistory(value, expectedEtag) {
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
        "gzip"
      );
    },

    async writePublicSnapshot(value) {
      decodePublicSnapshotDocument(value);
      await ownedWrite(
        client,
        config.name,
        BUCKET_KEYS.publicSnapshot,
        encodeJson(value),
        "application/json"
      );
    },

    async writePrivateSnapshot(value) {
      decodePrivateSnapshotDocument(value);
      await ownedWrite(
        client,
        config.name,
        BUCKET_KEYS.privateSnapshot,
        encodeJson(value),
        "application/json"
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
  key: string
): Promise<BucketObject> {
  const result = await optionalObject(client, bucket, key);
  if (!result) {
    throw new Error(`Required bucket object is missing: ${key}`);
  }
  return result;
}

async function optionalObject(
  client: S3Client,
  bucket: string,
  key: string
): Promise<BucketObject | null> {
  try {
    const result = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
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
  contentEncoding?: string
): Promise<string> {
  const previous = await optionalObject(client, bucket, key);
  if (previous) {
    const stamp = now().toISOString().replaceAll(":", "-");
    await ownedWrite(
      client,
      bucket,
      recoveryKey(`${stamp}/${key}`),
      previous.bytes,
      "application/json",
      previous.encoding
    );
  }
  const etag = await ownedWrite(
    client,
    bucket,
    key,
    bytes,
    contentType,
    contentEncoding,
    expectedEtag
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
  expectedEtag?: string | null
): Promise<string> {
  assertCheckerOwnedKey(key);
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
    })
  );
  return result.ETag ?? "";
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

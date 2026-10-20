import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  BUCKET_KEYS,
  decodePrivateSnapshotDocument,
  decodePublicSnapshotDocument,
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
  close(): void | Promise<void>;
}

export class CheckerConflictError extends Error {
  constructor(public readonly key: string) {
    super(`Checker object changed since it was read: ${key}`);
    this.name = "CheckerConflictError";
  }
}

export function createSnapshotStore(
  config: CheckerConfig["bucket"]
): Pick<CheckerStore, "writePublicSnapshot" | "writePrivateSnapshot" | "close"> {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });

  async function write(key: string, value: unknown, signal?: AbortSignal) {
    await client.send(new PutObjectCommand({
      Bucket: config.name,
      Key: key,
      Body: new TextEncoder().encode(JSON.stringify(value)),
      ContentType: "application/json"
    }), signal ? { abortSignal: signal } : undefined);
  }

  return {
    async writePublicSnapshot(value, signal) {
      decodePublicSnapshotDocument(value);
      await write(BUCKET_KEYS.publicSnapshot, value, signal);
    },
    async writePrivateSnapshot(value, signal) {
      decodePrivateSnapshotDocument(value);
      await write(BUCKET_KEYS.privateSnapshot, value, signal);
    },
    close() {
      client.destroy();
    }
  };
}

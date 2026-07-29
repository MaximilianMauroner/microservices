const MAX_DOCUMENTS = 200;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;
const FILENAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?\.md$/;

export interface MarkdownAdminDocument {
  token: string;
  filename: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  checkpointCount: number;
}

export interface MarkdownAdminSnapshot {
  generatedAt: number;
  documents: MarkdownAdminDocument[];
  truncated: boolean;
}

export interface MarkdownAdminReader {
  list(): Promise<MarkdownAdminSnapshot>;
}

export class MarkdownAdminUnavailableError extends Error {
  constructor() {
    super("Markdown Share admin inventory is unavailable");
    this.name = "MarkdownAdminUnavailableError";
  }
}

export function createMarkdownAdminClient(config: {
  endpoint: string;
  token: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): MarkdownAdminReader {
  const request = config.fetch ?? fetch;
  const timeoutMs = config.timeoutMs ?? 8_000;
  return {
    async list() {
      try {
        const response = await request(config.endpoint, {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${config.token}`,
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) throw new MarkdownAdminUnavailableError();
        return decodeMarkdownAdminSnapshot(await response.json());
      } catch (error) {
        if (error instanceof MarkdownAdminUnavailableError) throw error;
        throw new MarkdownAdminUnavailableError();
      }
    },
  };
}

export function decodeMarkdownAdminSnapshot(
  value: unknown,
): MarkdownAdminSnapshot {
  const record = object(value);
  const rawDocuments = record.documents;
  if (!Array.isArray(rawDocuments) || rawDocuments.length > MAX_DOCUMENTS) {
    throw new MarkdownAdminUnavailableError();
  }
  return {
    generatedAt: timestamp(record.generatedAt),
    documents: rawDocuments.map(decodeDocument),
    truncated: boolean(record.truncated),
  };
}

function decodeDocument(value: unknown): MarkdownAdminDocument {
  const record = object(value);
  const token = string(record.token);
  const filename = string(record.filename);
  const checkpointCount = number(record.checkpointCount);
  if (
    !TOKEN_PATTERN.test(token) ||
    !FILENAME_PATTERN.test(filename) ||
    filename.length > 80 ||
    !Number.isSafeInteger(checkpointCount) ||
    checkpointCount < 0
  ) {
    throw new MarkdownAdminUnavailableError();
  }
  return {
    token,
    filename,
    createdAt: timestamp(record.createdAt),
    updatedAt: timestamp(record.updatedAt),
    expiresAt: timestamp(record.expiresAt),
    checkpointCount,
  };
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MarkdownAdminUnavailableError();
  }
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  if (typeof value !== "string") throw new MarkdownAdminUnavailableError();
  return value;
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new MarkdownAdminUnavailableError();
  }
  return value;
}

function timestamp(value: unknown): number {
  const result = number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new MarkdownAdminUnavailableError();
  }
  return result;
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new MarkdownAdminUnavailableError();
  return value;
}

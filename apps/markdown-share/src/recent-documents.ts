import { TOKEN_PATTERN } from "./lib";

export const RECENT_DOCUMENTS_STORAGE_KEY =
  "markdown-share:recent-documents";
export const MAX_RECENT_DOCUMENTS = 50;

export type RecentDocument = {
  token: string;
  filename: string;
  expiresAt: number;
  lastOpenedAt: number;
};

function isRecentDocument(value: unknown): value is RecentDocument {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const entry = value as Partial<RecentDocument>;
  return (
    typeof entry.token === "string" &&
    TOKEN_PATTERN.test(entry.token) &&
    typeof entry.filename === "string" &&
    entry.filename.length > 0 &&
    entry.filename.length <= 80 &&
    typeof entry.expiresAt === "number" &&
    Number.isFinite(entry.expiresAt) &&
    typeof entry.lastOpenedAt === "number" &&
    Number.isFinite(entry.lastOpenedAt)
  );
}

export function parseRecentDocuments(
  stored: string | null,
  now = Date.now(),
): RecentDocument[] {
  if (!stored) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const documentsByToken = new Map<string, RecentDocument>();
    for (const value of parsed) {
      if (!isRecentDocument(value) || value.expiresAt <= now) {
        continue;
      }
      const existing = documentsByToken.get(value.token);
      if (!existing || existing.lastOpenedAt < value.lastOpenedAt) {
        documentsByToken.set(value.token, value);
      }
    }

    return [...documentsByToken.values()]
      .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)
      .slice(0, MAX_RECENT_DOCUMENTS);
  } catch {
    return [];
  }
}

export function upsertRecentDocument(
  documents: RecentDocument[],
  document: RecentDocument,
  now = Date.now(),
): RecentDocument[] {
  return [
    document,
    ...documents.filter((entry) => entry.token !== document.token),
  ]
    .filter((entry) => entry.expiresAt > now)
    .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)
    .slice(0, MAX_RECENT_DOCUMENTS);
}

export function readRecentDocuments(now = Date.now()): RecentDocument[] {
  try {
    return parseRecentDocuments(
      window.localStorage.getItem(RECENT_DOCUMENTS_STORAGE_KEY),
      now,
    );
  } catch {
    return [];
  }
}

export function writeRecentDocuments(documents: RecentDocument[]): void {
  try {
    window.localStorage.setItem(
      RECENT_DOCUMENTS_STORAGE_KEY,
      JSON.stringify(documents),
    );
  } catch {
    // The document remains usable when browser storage is unavailable.
  }
}

export function rememberRecentDocument(document: RecentDocument): void {
  writeRecentDocuments(
    upsertRecentDocument(readRecentDocuments(), document),
  );
}

export function forgetRecentDocument(token: string): RecentDocument[] {
  const documents = readRecentDocuments().filter(
    (document) => document.token !== token,
  );
  writeRecentDocuments(documents);
  return documents;
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const BUCKET_KEYS = {
  catalog: "catalog/current.json",
  checkerState: "state/current.json",
  publicSnapshot: "snapshots/public.json",
  privateSnapshot: "snapshots/private.json",
  recoveryPrefix: "recovery/",
  exportPrefix: "exports/"
} as const;

export function historyKey(day: string): string {
  const parsed = new Date(`${day}T00:00:00.000Z`);
  if (
    !DAY.test(day) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== day
  ) {
    throw new Error("History day must be a valid YYYY-MM-DD value");
  }
  return `history/${day}.json.gz`;
}

export function auditKey(
  occurredAt: string,
  id: string
): string {
  const parsed = new Date(occurredAt);
  if (
    !TIMESTAMP.test(occurredAt) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== occurredAt
  ) {
    throw new Error("Audit timestamp must be a canonical UTC timestamp");
  }
  if (!SAFE_ID.test(id)) {
    throw new Error("Audit ID must contain only URL-safe identifier characters");
  }
  const month = occurredAt.slice(0, 7);
  if (!MONTH.test(month)) {
    throw new Error("Audit timestamp month is invalid");
  }
  return `audit/${month.replace("-", "/")}/${occurredAt}-${id}.json`;
}

export function recoveryKey(name: string): string {
  return `${BUCKET_KEYS.recoveryPrefix}${safeObjectName(name)}`;
}

export function exportKey(name: string): string {
  return `${BUCKET_KEYS.exportPrefix}${safeObjectName(name)}`;
}

function safeObjectName(name: string): string {
  if (
    !name ||
    name.startsWith(".") ||
    name.includes("..") ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name)
  ) {
    throw new Error("Object name is unsafe");
  }
  return name;
}

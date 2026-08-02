type SyncFailureKind = "document-unavailable" | "retryable";

export type SyncFailure = {
  kind: SyncFailureKind;
  message: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function structuredErrorCode(error: Error): string | null {
  if (!("data" in error) || !isRecord(error.data)) {
    return null;
  }
  return typeof error.data.code === "string" ? error.data.code : null;
}

export function classifySyncError(error: Error): SyncFailure {
  if (structuredErrorCode(error) === "DOCUMENT_UNAVAILABLE") {
    return {
      kind: "document-unavailable",
      message:
        "This document is no longer available. Editing and new checkpoints are disabled. Copy any unsaved text before leaving this page.",
    };
  }

  return {
    kind: "retryable",
    message:
      "Changes could not be synchronized. Your latest edits may not be saved; try editing again, reloading, or reopening this page.",
  };
}

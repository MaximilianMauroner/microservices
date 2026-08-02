import { describe, expect, it } from "vitest";
import { ConvexError } from "convex/values";
import { classifySyncError } from "./sync-error";

describe("classifySyncError", () => {
  it("recognizes structured document-unavailable errors", () => {
    const error = new ConvexError({
      code: "DOCUMENT_UNAVAILABLE",
      message: "expired",
    });

    expect(classifySyncError(error)).toEqual({
      kind: "document-unavailable",
      message:
        "This document is no longer available. Editing and new checkpoints are disabled. Copy any unsaved text before leaving this page.",
    });
  });

  it("uses safe retry guidance for all other errors", () => {
    expect(classifySyncError(new Error("private server detail"))).toEqual({
      kind: "retryable",
      message:
        "Changes could not be synchronized. Your latest edits may not be saved; try editing again, reloading, or reopening this page.",
    });
  });
});

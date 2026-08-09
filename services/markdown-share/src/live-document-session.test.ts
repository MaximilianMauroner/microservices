import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import {
  classifySyncError,
  editorSaveLabel,
  editorSaveStatus,
} from "./live-document-session";

describe("live document session", () => {
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

  it("derives save state from pending changes and session failure", () => {
    expect(editorSaveStatus(true, null)).toBe("saving");
    const failure = { kind: "retryable", message: "failed" } as const;
    expect(editorSaveStatus(true, failure)).toBe("error");
    expect(editorSaveStatus(false, failure)).toBe("error");
  });

  it("provides concise labels for the top bar", () => {
    expect(editorSaveLabel("saved")).toBe("Saved");
    expect(editorSaveLabel("saving")).toBe("Saving…");
    expect(editorSaveLabel("error")).toBe("Save failed");
  });
});

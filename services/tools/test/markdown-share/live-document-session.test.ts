import { ShareError } from "../../markdown-share/types.js";
import { describe, expect, it } from "vitest";
import {
  classifySyncError,
  editorSaveLabel,
  editorSaveStatus,
} from "../../markdown-share/live-document-session.js";

describe("live document session", () => {
  it("recognizes structured document-unavailable errors", () => {
    const error = new ShareError("DOCUMENT_UNAVAILABLE", "expired");

    expect(classifySyncError(error)).toEqual({
      kind: "document-unavailable",
      message:
        "This document is no longer available. Editing and new checkpoints are disabled. Copy any unsaved text before leaving this page.",
    });
  });

  it("gives recovery guidance for a rejected oversized document", () => {
    expect(classifySyncError(new ShareError("DOCUMENT_TOO_LARGE", "oversized")).message).toContain("Undo or shorten");
  });

  it("uses safe retry guidance for all other errors", () => {
    expect(classifySyncError(new Error("private server detail"))).toEqual({
      kind: "retryable",
      message:
        "Changes could not be synchronized. Your latest edits may not be saved. Keep this page open and copy your source before leaving. Reconnection is automatic.",
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

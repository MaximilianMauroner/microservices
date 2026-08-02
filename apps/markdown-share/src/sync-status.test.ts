import { describe, expect, it } from "vitest";
import { editorSaveLabel, editorSaveStatus } from "./sync-status";

describe("editor save status", () => {
  it("reports pending collaborative steps as saving", () => {
    expect(editorSaveStatus(true, false)).toBe("saving");
  });

  it("keeps any reported sync failure visible", () => {
    expect(editorSaveStatus(true, true)).toBe("error");
    expect(editorSaveStatus(false, true)).toBe("error");
  });

  it("provides concise labels for the top bar", () => {
    expect(editorSaveLabel("saved")).toBe("Saved");
    expect(editorSaveLabel("saving")).toBe("Saving…");
    expect(editorSaveLabel("error")).toBe("Save failed");
  });
});

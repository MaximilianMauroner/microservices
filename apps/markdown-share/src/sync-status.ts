export type EditorSaveStatus = "saved" | "saving" | "error";

export function editorSaveStatus(
  hasPendingSteps: boolean,
  hasSyncError: boolean,
): EditorSaveStatus {
  if (hasSyncError) {
    return "error";
  }
  return hasPendingSteps ? "saving" : "saved";
}

export function editorSaveLabel(status: EditorSaveStatus): string {
  switch (status) {
    case "saved":
      return "Saved";
    case "saving":
      return "Saving…";
    case "error":
      return "Save failed";
  }
}

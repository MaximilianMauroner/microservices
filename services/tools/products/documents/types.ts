export type DocumentFormat = "markdown" | "latex";
export type PublicDocument = {
  token: string;
  filename: string;
  format: DocumentFormat;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  pinned: boolean;
};
export type EditorContent = { type: string; attrs?: Record<string, unknown>; text?: string; content?: EditorContent[] };
export type DocumentSnapshot = { document: PublicDocument; content: EditorContent; version: number };
export type PresenceEntry = { userId: string; online: boolean; lastDisconnected: number; name?: string };
export type PresenceIdentity = { sessionId: string; userId: string; name: string };
export type CheckpointSummary = { _id: string; createdAt: number; createdBy: string; charCount: number; version: number };
export type CheckpointBody = Omit<CheckpointSummary, "charCount"> & { markdown: string };
export type CheckpointComparison = { older: CheckpointBody; newer: CheckpointBody };
export type SyncUpdate = {
  document: PublicDocument;
  version: number;
  steps: unknown[];
  clientIds: string[];
  presence: PresenceEntry[];
  checkpoints: CheckpointSummary[];
};
export type SubmitSteps = { version: number; clientId: string; steps: unknown[] };
export type SubmitResult = SyncUpdate & { status: "synced" | "rebase" };
export type CreateDocument = { requestId: string; filename: string; format: DocumentFormat; markdown: string };
export type ShareErrorCode = "DOCUMENT_UNAVAILABLE" | "DOCUMENT_TOO_LARGE" | "INVALID_EDITOR_PAYLOAD" | "INVALID_FILENAME" | "INVALID_CHECKPOINT" | "CHECKPOINT_LIMIT_REACHED" | "INVALID_DISPLAY_NAME" | "HISTORY_UNAVAILABLE";
export class ShareError extends Error {
  readonly data: { code: ShareErrorCode; message: string };
  constructor(code: ShareErrorCode, message: string) {
    super(message);
    this.name = "ShareError";
    this.data = { code, message };
  }
}

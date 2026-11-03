export interface MarkdownAdminDocument {
  token: string;
  filename: string;
  format?: "markdown" | "latex";
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  checkpointCount: number;
}

export interface MarkdownAdminSnapshot {
  generatedAt: number;
  documents: MarkdownAdminDocument[];
  truncated: boolean;
  nextCursor?: string;
}

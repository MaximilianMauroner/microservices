export class UploadCancelledError extends Error {
  constructor() {
    super("Upload cancelled.");
    this.name = "UploadCancelledError";
  }
}

export function friendlyUploadError(status: number, serverMessage?: string) {
  const base = serverMessage?.trim() ?? "";
  if (status === 401) {
    return base.toLowerCase().includes("session") && base
      ? base
      : "Your session expired. Sign in again, then retry.";
  }
  if (status === 403) return base || "Upload blocked. Open Publish from the app, then retry.";
  if (status === 413) return base || "The file exceeds the configured size limit.";
  if (status === 415) return base || "Unsupported upload type.";
  if (status === 409) return `${base || "The file changed during upload."} Retry.`;
  if (status === 503) {
    return base.toLowerCase().includes("maximum") && base
      ? `${base} Wait a moment, then retry.`
      : "The server is busy. Wait a moment, then retry.";
  }
  if (base) return base;
  if (status > 0) return `Upload failed (HTTP ${status}).`;
  return "The connection was interrupted. Check your network, then retry.";
}


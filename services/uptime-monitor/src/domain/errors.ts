import type { ErrorCode } from "../shared/contracts";

export class CheckError extends Error {
  constructor(public readonly code: ErrorCode, message: string) { super(message); this.name = "CheckError"; }
}

export function normalizedError(error: unknown): ErrorCode {
  if (error instanceof CheckError) return error.code;
  if (error instanceof DOMException && error.name === "AbortError") return "timeout";
  return "network_error";
}

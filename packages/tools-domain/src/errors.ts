import type { CheckErrorCode } from "./types.js";

export class SchemaDecodeError extends Error {
  constructor(
    public readonly path: string,
    message: string
  ) {
    super(`${path}: ${message}`);
    this.name = "SchemaDecodeError";
  }
}

export class CheckError extends Error {
  constructor(
    public readonly code: CheckErrorCode,
    message: string
  ) {
    super(message);
    this.name = "CheckError";
  }
}

export function normalizedCheckError(error: unknown): CheckErrorCode {
  if (error instanceof CheckError) {
    return error.code;
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return "timeout";
  }
  return "network_error";
}

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("The request body is too large.");
    this.name = "RequestBodyTooLargeError";
  }
}

/**
 * Reads at most `maximumBytes` of the body and stops reading as soon as it is over.
 * Returns undefined when the request has no body.
 */
export async function readBoundedBody(request: Request, maximumBytes: number): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)) throw new RequestBodyTooLargeError();
  const reader = request.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

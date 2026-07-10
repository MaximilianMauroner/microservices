import { createWriteStream, type WriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { Transform, type Readable, type TransformCallback } from "node:stream";
import type { Request } from "express";
import type multer from "multer";

type HandleFileCallback = (
  error?: unknown,
  info?: Partial<Express.Multer.File>
) => void;

export type MultipartStagingOptions = {
  destination: string;
  filename: (file: Express.Multer.File) => string;
  isHtmlUpload: (file: Express.Multer.File) => boolean;
  maxHtmlUploadBytes: number;
};

type StagingState = {
  created: boolean;
  filePath: string;
  limiter: ByteLimitTransform;
  output: WriteStream;
  settled: boolean;
  source: Readable;
};

export class HtmlPayloadTooLargeError extends Error {
  readonly code = "HTML_PAYLOAD_TOO_LARGE";

  constructor(
    readonly limitBytes: number,
    readonly stagedBytes: number
  ) {
    super(`HTML uploads may not exceed ${limitBytes} bytes.`);
    this.name = "HtmlPayloadTooLargeError";
  }
}

export function createMultipartStagingStorage(
  options: MultipartStagingOptions
): multer.StorageEngine {
  return new MultipartStagingStorage(options);
}

class MultipartStagingStorage implements multer.StorageEngine {
  private readonly states = new WeakMap<Express.Multer.File, StagingState>();

  constructor(private readonly options: MultipartStagingOptions) {}

  _handleFile(_req: Request, file: Express.Multer.File, callback: HandleFileCallback) {
    let filename: string;
    let maxBytes: number | undefined;
    try {
      filename = path.basename(this.options.filename(file));
      if (!filename || filename === "." || filename === "..") {
        throw new Error("Multipart staging filename is invalid");
      }
      maxBytes = this.options.isHtmlUpload(file)
        ? this.options.maxHtmlUploadBytes
        : undefined;
    } catch (error) {
      callback(error);
      return;
    }

    const filePath = path.join(this.options.destination, filename);
    const limiter = new ByteLimitTransform(maxBytes);
    const output = createWriteStream(filePath, { flags: "wx" });
    const state: StagingState = {
      created: false,
      filePath,
      limiter,
      output,
      settled: false,
      source: file.stream
    };
    this.states.set(file, state);

    file.destination = this.options.destination;
    file.filename = filename;
    file.path = filePath;

    output.once("open", () => {
      state.created = true;
    });
    limiter.once("error", (error) => {
      this.failStaging(file, state, error, callback);
    });
    output.once("error", (error) => {
      this.failStaging(file, state, error, callback);
    });
    output.once("finish", () => {
      if (state.settled) {
        return;
      }

      state.settled = true;
      this.states.delete(file);
      callback(null, {
        destination: this.options.destination,
        filename,
        path: filePath,
        size: limiter.bytesAccepted
      });
    });

    file.stream.pipe(limiter).pipe(output);
  }

  _removeFile(
    _req: Request,
    file: Express.Multer.File,
    callback: (error: Error | null) => void
  ) {
    const state = this.states.get(file);
    if (state) {
      state.settled = true;
      this.states.delete(file);
      stopStaging(state);
      void removeAfterClose(state).then(() => callback(null), callback);
      return;
    }

    void unlinkIfPresent(file.path).then(() => callback(null), callback);
  }

  private failStaging(
    file: Express.Multer.File,
    state: StagingState,
    error: Error,
    callback: HandleFileCallback
  ) {
    if (state.settled) {
      return;
    }

    state.settled = true;
    this.states.delete(file);
    stopStaging(state);
    void removeAfterClose(state).then(() => callback(error), callback);
  }
}

class ByteLimitTransform extends Transform {
  bytesAccepted = 0;

  constructor(private readonly maxBytes?: number) {
    super();
  }

  override _transform(chunk: unknown, encoding: BufferEncoding, callback: TransformCallback) {
    const buffer = toBuffer(chunk, encoding);
    if (!buffer) {
      callback(new TypeError("Multipart file stream emitted a non-byte chunk"));
      return;
    }

    if (this.maxBytes !== undefined && this.bytesAccepted + buffer.length > this.maxBytes) {
      callback(new HtmlPayloadTooLargeError(this.maxBytes, this.bytesAccepted));
      return;
    }

    this.bytesAccepted += buffer.length;
    callback(null, buffer);
  }
}

function toBuffer(chunk: unknown, encoding: BufferEncoding) {
  if (typeof chunk === "string") {
    return Buffer.from(chunk, encoding);
  }
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk);
  }

  return null;
}

function stopStaging(state: StagingState) {
  state.source.unpipe(state.limiter);
  state.limiter.unpipe(state.output);
  state.source.resume();
  state.limiter.destroy();
  state.output.destroy();
}

async function removeAfterClose(state: StagingState) {
  if (!state.output.closed) {
    await new Promise<void>((resolve) => {
      state.output.once("close", resolve);
    });
  }
  if (state.created) {
    await unlinkIfPresent(state.filePath);
  }
}

async function unlinkIfPresent(filePath: string) {
  try {
    await unlink(filePath);
  } catch (error) {
    const candidate = error as { code?: string };
    if (candidate.code !== "ENOENT") {
      throw error;
    }
  }
}

import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import type { Request } from "express";
import { describe, expect, it } from "vitest";
import {
  createMultipartStagingStorage,
  HtmlPayloadTooLargeError
} from "../src/multipart-staging.js";

describe("multipart staging", () => {
  it("bounds staged HTML bytes and removes the partial file", async () => {
    const destination = await mkdtemp(path.join(os.tmpdir(), "html-publisher-staging-test-"));

    try {
      const storage = createMultipartStagingStorage({
        destination,
        filename: () => "staged-upload",
        isHtmlUpload: () => true,
        maxHtmlUploadBytes: 8
      });
      const file = {
        buffer: Buffer.alloc(0),
        destination: "",
        encoding: "7bit",
        fieldname: "file",
        filename: "",
        mimetype: "text/html",
        originalname: "page.html",
        path: "",
        size: 0,
        stream: Readable.from([Buffer.alloc(5), Buffer.alloc(5)])
      } satisfies Express.Multer.File;

      const result = await new Promise<{
        error?: unknown;
        info?: Partial<Express.Multer.File>;
      }>((resolve) => {
        storage._handleFile(
          {} as Request,
          file,
          (error?: unknown, info?: Partial<Express.Multer.File>) => resolve({ error, info })
        );
      });

      expect(result.info).toBeUndefined();
      expect(result.error).toBeInstanceOf(HtmlPayloadTooLargeError);
      if (!(result.error instanceof HtmlPayloadTooLargeError)) {
        throw new Error("Expected an HTML staging limit error");
      }
      expect(result.error.stagedBytes).toBeLessThanOrEqual(result.error.limitBytes);
      expect(result.error.stagedBytes).toBe(5);
      expect(await readdir(destination)).toEqual([]);
    } finally {
      await rm(destination, { force: true, recursive: true });
    }
  });
});

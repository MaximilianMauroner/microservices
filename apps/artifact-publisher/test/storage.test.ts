import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createS3UploadStorage, HtmlUpdateConflictError } from "../src/storage.js";

const storageConfig = {
  bucket: "bucket",
  endpoint: "https://storage.example",
  region: "region",
  accessKeyId: "access-key",
  secretAccessKey: "secret-key"
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("S3 upload storage", () => {
  it("overwrites the same HTML key with refreshed metadata", async () => {
    const commands: PutObjectCommand[] = [];
    vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command) => {
      if (!(command instanceof PutObjectCommand)) {
        throw new Error("Unexpected S3 command");
      }
      commands.push(command);
      return {} as never;
    });
    const storage = createS3UploadStorage(storageConfig);

    await storage.putHtml("stable-id", "/dev/null", {
      bytes: 0,
      originalName: "first.html",
      sha256: "a".repeat(64)
    });
    await storage.putHtml(
      "stable-id",
      "/dev/null",
      {
        bytes: 0,
        originalName: "revised.html",
        sha256: "b".repeat(64)
      },
      { ifMatch: '"current-etag"' }
    );

    expect(commands.map((command) => command.input.Key)).toEqual([
      "pages/stable-id.html",
      "pages/stable-id.html"
    ]);
    expect(commands[1]?.input.Metadata).toMatchObject({
      "original-name": "revised.html",
      sha256: "b".repeat(64)
    });
    expect(commands[1]?.input.IfMatch).toBe('"current-etag"');
    for (const command of commands) {
      if (command.input.Body instanceof Readable) {
        command.input.Body.destroy();
      }
    }
    storage.close?.();
  });

  it("maps conditional S3 write failures to an HTML update conflict", async () => {
    vi.spyOn(S3Client.prototype, "send").mockRejectedValue(
      Object.assign(new Error("precondition failed"), {
        name: "PreconditionFailed",
        $metadata: { httpStatusCode: 412 }
      })
    );
    const storage = createS3UploadStorage(storageConfig);

    await expect(
      storage.putHtml(
        "stable-id",
        "/dev/null",
        {
          bytes: 0,
          originalName: "revised.html",
          sha256: "b".repeat(64)
        },
        { ifMatch: '"stale-etag"' }
      )
    ).rejects.toBeInstanceOf(HtmlUpdateConflictError);
    storage.close?.();
  });

  it("streams HTML bodies with representation metadata", async () => {
    const body = Buffer.from("<html>streamed</html>");
    vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) {
        return {
          ContentLength: body.length,
          LastModified: new Date("2026-07-10T12:00:00.000Z"),
          Metadata: { sha256: "a".repeat(64) }
        } as never;
      }
      if (command instanceof GetObjectCommand) {
        return {
          Body: Readable.from(body),
          ContentLength: body.length,
          LastModified: new Date("2026-07-10T12:00:00.000Z"),
          Metadata: { sha256: "a".repeat(64) }
        } as never;
      }
      throw new Error("Unexpected S3 command");
    });
    const storage = createS3UploadStorage(storageConfig);

    const page = await storage.getHtml("page-id");
    expect(page?.body).toBeInstanceOf(Readable);
    expect(page).toMatchObject({ bytes: body.length, sha256: "a".repeat(64) });

    const chunks: Buffer[] = [];
    if (!page) {
      throw new Error("Expected stored page");
    }
    for await (const chunk of page.body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks)).toEqual(body);

    const head = await storage.getHtml("page-id", { headOnly: true });
    expect(head).toMatchObject({ bytes: body.length, sha256: "a".repeat(64) });
    expect(head?.body.readableLength).toBe(0);
    storage.close?.();
  });

  it("deletes only objects whose stored expiry has elapsed", async () => {
    const deletedKeys: string[] = [];
    vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command) => {
      if (command instanceof ListObjectsV2Command) {
        return {
          Contents: [
            { Key: "files/expired", LastModified: new Date("2026-07-10T11:59:59.000Z") },
            { Key: "files/future", LastModified: new Date("2026-07-01T00:00:00.000Z") },
            { Key: "files/malformed", LastModified: new Date("2026-07-01T00:00:00.000Z") }
          ]
        } as never;
      }
      if (command instanceof HeadObjectCommand) {
        const expiresAt =
          command.input.Key === "files/expired"
            ? "2026-07-10T12:00:00.000Z"
            : command.input.Key === "files/future"
              ? "2026-07-11T12:00:00.000Z"
              : "not-a-date";
        return { Metadata: { "expires-at": expiresAt } } as never;
      }
      if (command instanceof DeleteObjectCommand) {
        if (command.input.Key) {
          deletedKeys.push(command.input.Key);
        }
        return {} as never;
      }

      throw new Error("Unexpected S3 command");
    });
    const storage = createS3UploadStorage(storageConfig);

    await expect(
      storage.deleteExpiredTemporaryFiles(new Date("2026-07-10T12:00:00.000Z"))
    ).resolves.toBe(1);
    expect(deletedKeys).toEqual(["files/expired"]);
    storage.close?.();
  });

  it("lists plans and unexpired files by most recent metadata", async () => {
    const pageId = "p".repeat(32);
    const fileId = "f".repeat(32);
    const expiredId = "e".repeat(32);
    vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command) => {
      if (command instanceof ListObjectsV2Command) {
        return command.input.Prefix === "pages/"
          ? ({
              Contents: [
                {
                  Key: `pages/${pageId}.html`,
                  LastModified: new Date("2026-07-22T10:00:00.000Z")
                },
                { Key: "pages/not-an-upload.html" }
              ]
            } as never)
          : ({
              Contents: [
                {
                  Key: `files/${fileId}`,
                  LastModified: new Date("2026-07-23T10:00:00.000Z")
                },
                {
                  Key: `files/${expiredId}`,
                  LastModified: new Date("2026-07-24T10:00:00.000Z")
                }
              ]
            } as never);
      }
      if (command instanceof HeadObjectCommand) {
        if (command.input.Key === `pages/${pageId}.html`) {
          return {
            ContentLength: 120,
            ContentType: "text/html; charset=utf-8",
            LastModified: new Date("2026-07-22T10:00:00.000Z"),
            Metadata: { "original-name": "agent-browser-plan-123.html" }
          } as never;
        }
        if (command.input.Key === `files/${fileId}`) {
          return {
            ContentLength: 45,
            ContentType: "text/plain",
            LastModified: new Date("2026-07-23T10:00:00.000Z"),
            Metadata: {
              "expires-at": "2026-07-26T10:00:00.000Z",
              "original-name": "notes.txt"
            }
          } as never;
        }
        return {
          LastModified: new Date("2026-07-24T10:00:00.000Z"),
          Metadata: {
            "expires-at": "2026-07-22T10:00:00.000Z",
            "original-name": "expired.zip"
          }
        } as never;
      }
      throw new Error("Unexpected S3 command");
    });
    const storage = createS3UploadStorage(storageConfig);

    const firstPage = await storage.listUploads(
      new Date("2026-07-23T12:00:00.000Z"),
      { limit: 1 }
    );
    expect(firstPage).toEqual({
      uploads: [
        {
          id: fileId,
          kind: "file",
          originalName: "notes.txt",
          bytes: 45,
          contentType: "text/plain",
          updatedAt: new Date("2026-07-23T10:00:00.000Z"),
          expiresAt: new Date("2026-07-26T10:00:00.000Z")
        }
      ],
      nextCursor: {
        version: 1,
        criteria: "legacy:newest",
        updatedAt: new Date("2026-07-23T10:00:00.000Z"),
        key: `files/${fileId}`,
        originalName: "notes.txt",
        expiresAt: new Date("2026-07-26T10:00:00.000Z")
      }
    });

    await expect(
      storage.listUploads(new Date("2026-07-23T12:00:00.000Z"), {
        limit: 1,
        cursor: firstPage.nextCursor
      })
    ).resolves.toEqual({
      uploads: [
        {
          id: pageId,
          kind: "html",
          originalName: "agent-browser-plan-123.html",
          bytes: 120,
          contentType: "text/html; charset=utf-8",
          updatedAt: new Date("2026-07-22T10:00:00.000Z")
        }
      ]
    });
    await expect(storage.listUploads(new Date("2026-07-23T12:00:00.000Z"), { limit: 1, q: " NOTES " })).resolves.toMatchObject({ uploads: [{ originalName: "notes.txt" }] });
    await expect(storage.listUploads(new Date("2026-07-23T12:00:00.000Z"), { limit: 1, expiry: "persistent" })).resolves.toMatchObject({ uploads: [{ kind: "html" }] });
    await expect(storage.listUploads(new Date("2026-07-23T12:00:00.000Z"), { limit: 10, sort: "oldest" })).resolves.toMatchObject({ uploads: [{ kind: "html" }, { kind: "file" }] });
    await expect(storage.listUploads(new Date("2026-07-23T12:00:00.000Z"), { limit: 10, sort: "expiry" })).resolves.toMatchObject({ uploads: [{ kind: "file" }, { kind: "html" }] });
    storage.close?.();
  });

  it("attempts both upload keys before reporting deletion failures", async () => {
    const attemptedKeys: string[] = [];
    vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command) => {
      if (!(command instanceof DeleteObjectCommand)) {
        throw new Error("Unexpected S3 command");
      }

      attemptedKeys.push(command.input.Key ?? "");
      if (command.input.Key === "files/upload-id") {
        throw new Error("Temporary object deletion failed");
      }
      return {} as never;
    });
    const storage = createS3UploadStorage(storageConfig);

    await expect(storage.deleteUpload("upload-id")).rejects.toBeInstanceOf(AggregateError);
    expect(attemptedKeys).toEqual(["files/upload-id", "pages/upload-id.html"]);
    storage.close?.();
  });

  it("continues expiry cleanup after object failures and across pages", async () => {
    const continuationTokens: Array<string | undefined> = [];
    const deleteAttempts: string[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command) => {
      if (command instanceof ListObjectsV2Command) {
        continuationTokens.push(command.input.ContinuationToken);
        return command.input.ContinuationToken
          ? ({ Contents: [{ Key: "files/second-page" }] } as never)
          : ({
              Contents: [
                { Key: "files/head-failure" },
                { Key: "files/delete-failure" },
                { Key: "files/first-page" }
              ],
              NextContinuationToken: "next-page"
            } as never);
      }

      if (command instanceof HeadObjectCommand) {
        if (command.input.Key === "files/head-failure") {
          throw new Error("HEAD failed");
        }
        return { Metadata: { "expires-at": "2026-07-10T12:00:00.000Z" } } as never;
      }

      if (command instanceof DeleteObjectCommand) {
        const key = command.input.Key ?? "";
        deleteAttempts.push(key);
        if (key === "files/delete-failure") {
          throw new Error("DELETE failed");
        }
        return {} as never;
      }

      throw new Error("Unexpected S3 command");
    });
    const storage = createS3UploadStorage(storageConfig);

    await expect(
      storage.deleteExpiredTemporaryFiles(new Date("2026-07-10T12:00:00.000Z"))
    ).resolves.toBe(2);
    expect(continuationTokens).toEqual([undefined, "next-page"]);
    expect(deleteAttempts).toEqual([
      "files/delete-failure",
      "files/first-page",
      "files/second-page"
    ]);
    expect(consoleError).toHaveBeenCalledTimes(2);
    storage.close?.();
  });

  it("recovers expiry and length when S3 rejects a byte range", async () => {
    vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command) => {
      if (command instanceof GetObjectCommand) {
        throw Object.assign(new Error("Invalid range"), {
          name: "InvalidRange",
          $metadata: { httpStatusCode: 416 }
        });
      }
      if (command instanceof HeadObjectCommand) {
        return {
          ContentLength: 5,
          ContentType: "text/plain",
          Metadata: {
            "expires-at": "2026-07-13T12:00:00.000Z",
            "original-name": "note.txt"
          }
        } as never;
      }
      throw new Error("Unexpected S3 command");
    });
    const storage = createS3UploadStorage(storageConfig);

    await expect(storage.getTemporaryFile("file-id", { range: "bytes=100-" })).rejects.toMatchObject(
      {
        name: "RangeNotSatisfiableError",
        totalBytes: 5,
        expiresAt: new Date("2026-07-13T12:00:00.000Z")
      }
    );
    storage.close?.();
  });

  it("encodes Unicode names into ASCII-safe object metadata", async () => {
    let putCommand: PutObjectCommand | undefined;
    vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command) => {
      if (!(command instanceof PutObjectCommand)) {
        throw new Error("Unexpected S3 command");
      }
      putCommand = command;
      return {} as never;
    });
    const storage = createS3UploadStorage(storageConfig);

    await storage.putTemporaryFile("file-id", "/dev/null", {
      bytes: 0,
      contentType: "application/pdf",
      expiresAt: new Date("2026-07-13T12:00:00.000Z"),
      originalName: "résumé-计划.pdf",
      sha256: "b".repeat(64)
    });

    const metadata = putCommand?.input.Metadata;
    expect(metadata?.["original-name-base64"]).toBeDefined();
    expect(Object.values(metadata ?? {}).every((value) => /^[\x20-\x7E]+$/.test(value))).toBe(
      true
    );
    if (putCommand?.input.Body instanceof Readable) {
      putCommand.input.Body.destroy();
    }
    storage.close?.();
  });
});

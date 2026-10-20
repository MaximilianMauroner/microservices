import { Readable } from "node:stream";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createS3BodyStorage, HtmlUpdateConflictError } from "../src/storage.js";

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

describe("S3 body storage", () => {
  it("signs a short-lived direct file read without requesting the object", async () => {
    const send = vi.spyOn(S3Client.prototype, "send");
    const storage = createS3BodyStorage(storageConfig);

    const signed = await storage.presignTemporaryFile?.("file-id", 10);
    const url = new URL(signed ?? "");
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toContain("storage.example");
    expect(url.pathname).toContain("files/file-id");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("10");
    expect(url.searchParams.has("X-Amz-Signature")).toBe(true);
    expect(send).not.toHaveBeenCalled();
    storage.close?.();
  });

  it("signs large attachments with a safe download filename, type, and cache policy", async () => {
    const send = vi.spyOn(S3Client.prototype, "send");
    const storage = createS3BodyStorage(storageConfig);

    const signed = await storage.presignTemporaryFile?.("file-id", 3600, {
      kind: "attachment", filename: 'folder/Quarterly “report”.pdf'
    });
    const url = new URL(signed ?? "");

    expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(url.searchParams.get("response-content-disposition")).toBe(
      "attachment; filename=\"Quarterly _report_.pdf\"; filename*=UTF-8''Quarterly%20%E2%80%9Creport%E2%80%9D.pdf"
    );
    expect(url.searchParams.get("response-content-type")).toBe("application/octet-stream");
    expect(url.searchParams.get("response-cache-control")).toBe("private, no-store");
    expect(url.searchParams.has("X-Amz-Signature")).toBe(true);
    expect(send).not.toHaveBeenCalled();
    storage.close?.();
  });

  it("does not enable optional AWS streaming checksums for S3-compatible storage", async () => {
    let requestChecksumCalculation: string | undefined;
    let putCommand: PutObjectCommand | undefined;
    vi.spyOn(S3Client.prototype, "send").mockImplementation(async function (
      this: S3Client,
      command
    ) {
      requestChecksumCalculation = await this.config.requestChecksumCalculation();
      if (!(command instanceof PutObjectCommand)) {
        throw new Error("Unexpected S3 command");
      }
      putCommand = command;
      return {} as never;
    });
    const storage = createS3BodyStorage(storageConfig);

    await storage.putTemporaryFile("file-id", "/dev/null", {
      bytes: 0,
      contentType: "application/octet-stream",
      expiresAt: new Date("2026-07-13T12:00:00.000Z"),
      originalName: "release.apk",
      sha256: "a".repeat(64)
    });

    expect(requestChecksumCalculation).toBe("WHEN_REQUIRED");
    if (putCommand?.input.Body instanceof Readable) {
      putCommand.input.Body.destroy();
    }
    storage.close?.();
  });

  it("overwrites the same HTML key with refreshed metadata", async () => {
    const commands: PutObjectCommand[] = [];
    vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command) => {
      if (!(command instanceof PutObjectCommand)) {
        throw new Error("Unexpected S3 command");
      }
      commands.push(command);
      return {} as never;
    });
    const storage = createS3BodyStorage(storageConfig);

    await storage.putHtml("stable-id", "/dev/null", {
      bytes: 0,
      originalName: "first.html",
      sha256: "a".repeat(64),
      project: "microservices"
    });
    await storage.putHtml(
      "stable-id",
      "/dev/null",
      {
        bytes: 0,
        originalName: "revised.html",
        sha256: "b".repeat(64),
        project: "microservices"
      },
      { ifMatch: '"current-etag"' }
    );

    expect(commands.map((command) => command.input.Key)).toEqual([
      "pages/stable-id.html",
      "pages/stable-id.html"
    ]);
    expect(commands[1]?.input.Metadata).toMatchObject({
      "original-name": "revised.html",
      "project-base64": Buffer.from("microservices").toString("base64"),
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
    const storage = createS3BodyStorage(storageConfig);

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


  it("changes file expiry metadata and removes it for permanent files", async () => {
    const copies: CopyObjectCommand[] = [];
    vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) {
        return {
          ETag: '"current-etag"',
          CacheControl: "private, no-store",
          ContentDisposition: 'attachment; filename="report.pdf"',
          ContentType: "application/pdf",
          Metadata: {
            bytes: "12",
            sha256: "a".repeat(64),
            "expires-at": "2026-08-17T12:00:00.000Z"
          }
        } as never;
      }
      if (command instanceof CopyObjectCommand) {
        copies.push(command);
        return {} as never;
      }
      throw new Error("Unexpected S3 command");
    });
    const storage = createS3BodyStorage(storageConfig);
    const expiresAt = new Date("2026-08-30T12:00:00.000Z");

    await expect(storage.updateFileExpiry("stable-id", expiresAt)).resolves.toBe(true);
    await expect(storage.updateFileExpiry("stable-id", null)).resolves.toBe(true);

    expect(copies[0]?.input).toMatchObject({
      Key: "files/stable-id",
      CopySourceIfMatch: '"current-etag"',
      Expires: expiresAt,
      Metadata: { "expires-at": expiresAt.toISOString() }
    });
    expect(copies[1]?.input.Expires).toBeUndefined();
    expect(copies[1]?.input.Metadata).not.toHaveProperty("expires-at");
    storage.close?.();
  });

  it("streams HTML bodies with representation metadata", async () => {
    const body = Buffer.from("<html>streamed</html>");
    vi.spyOn(S3Client.prototype, "send").mockImplementation(async (command) => {
      if (command instanceof HeadObjectCommand) {
        return {
          ContentLength: body.length,
          LastModified: new Date("2026-07-10T12:00:00.000Z"),
          Metadata: {
            sha256: "a".repeat(64),
            "project-base64": Buffer.from("microservices").toString("base64")
          }
        } as never;
      }
      if (command instanceof GetObjectCommand) {
        return {
          Body: Readable.from(body),
          ContentLength: body.length,
          LastModified: new Date("2026-07-10T12:00:00.000Z"),
          Metadata: {
            sha256: "a".repeat(64),
            "project-base64": Buffer.from("microservices").toString("base64")
          }
        } as never;
      }
      throw new Error("Unexpected S3 command");
    });
    const storage = createS3BodyStorage(storageConfig);

    const page = await storage.getHtml("page-id");
    expect(page?.body).toBeInstanceOf(Readable);
    expect(page).toMatchObject({
      bytes: body.length,
      sha256: "a".repeat(64),
      project: "microservices"
    });

    const chunks: Buffer[] = [];
    if (!page) {
      throw new Error("Expected stored page");
    }
    for await (const chunk of page.body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks)).toEqual(body);

    const head = await storage.getHtml("page-id", { headOnly: true });
    expect(head).toMatchObject({
      bytes: body.length,
      sha256: "a".repeat(64),
      project: "microservices"
    });
    expect(head?.body.readableLength).toBe(0);
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
    const storage = createS3BodyStorage(storageConfig);

    await expect(storage.deleteUpload("upload-id")).rejects.toBeInstanceOf(AggregateError);
    expect(attemptedKeys).toEqual(["files/upload-id", "pages/upload-id.html", "transfers/upload-id"]);
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
    const storage = createS3BodyStorage(storageConfig);

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
    const storage = createS3BodyStorage(storageConfig);

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

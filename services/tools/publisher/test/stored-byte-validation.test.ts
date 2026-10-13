import crypto from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { verifyStoredBytes } from "../src/multipart-storage.js";
const digest = (bytes: Uint8Array) => crypto.createHash("sha256").update(bytes).digest("hex");

describe("stored byte verification", () => {
  it("checks digests across stream and part boundaries, including empty files", async () => {
    const bytes = Buffer.from("abcdefghij");
    const description = { kind: "file" as const, filename: "fixture.bin", contentType: "application/octet-stream", totalBytes: 10, partBytes: 6 };
    const parts = [bytes.subarray(0, 6), bytes.subarray(6)].map((part, index) => ({ number: index + 1, bytes: part.length, etag: "irrelevant", sha256: digest(part) }));
    const stream = () => Readable.from([bytes.subarray(0, 2), bytes.subarray(2, 8), bytes.subarray(8)]);
    expect(await verifyStoredBytes(stream(), description, parts, new AbortController().signal)).toBe(digest(bytes));
    await expect(verifyStoredBytes(stream(), description, [{ ...parts[0]!, sha256: "0".repeat(64) }, parts[1]!], new AbortController().signal)).rejects.toMatchObject({ code: "checksum_mismatch" });
    await expect(verifyStoredBytes(Readable.from([bytes.subarray(0, 8)]), description, parts, new AbortController().signal)).rejects.toMatchObject({ code: "size_mismatch" });
    expect(await verifyStoredBytes(Readable.from([]), { ...description, totalBytes: 0 }, [{ number: 1, bytes: 0, etag: "empty", sha256: digest(Buffer.alloc(0)) }], new AbortController().signal)).toBe(digest(Buffer.alloc(0)));
  });
});


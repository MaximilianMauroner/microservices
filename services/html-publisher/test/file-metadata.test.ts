import { describe, expect, it } from "vitest";
import {
  attachmentDisposition,
  normalizeMimeType,
  originalNameMetadata,
  readOriginalNameMetadata,
  safeFileName
} from "../src/file-metadata.js";

describe("file metadata", () => {
  it("normalizes portable, bounded file names", () => {
    expect(safeFileName("C:\\Users\\test\\report.pdf", "download.bin")).toBe("report.pdf");
    expect(safeFileName("../..", "download.bin")).toBe("download.bin");

    const bounded = safeFileName("🧪".repeat(100), "download.bin");
    expect(Buffer.byteLength(bounded, "utf8")).toBeLessThanOrEqual(240);
  });

  it("preserves Unicode names through ASCII-only S3 metadata", () => {
    const originalName = "résumé-计划.pdf";
    const metadata = originalNameMetadata(originalName);

    expect(Object.values(metadata).every((value) => /^[\x20-\x7E]+$/.test(value))).toBe(true);
    expect(readOriginalNameMetadata(metadata, "download.bin")).toBe(originalName);
  });

  it("adds an RFC 5987 filename for Unicode downloads without changing ASCII headers", () => {
    expect(attachmentDisposition("report.pdf")).toBe('attachment; filename="report.pdf"');
    expect(attachmentDisposition("résumé.pdf")).toBe(
      'attachment; filename="r_sum_.pdf"; filename*=UTF-8\'\'r%C3%A9sum%C3%A9.pdf'
    );
  });

  it("normalizes valid MIME types and rejects unsafe values", () => {
    expect(normalizeMimeType("Text/Plain; charset=utf-8")).toBe("text/plain");
    expect(normalizeMimeType("text/plain\r\nx-test: injected")).toBe("application/octet-stream");
    expect(normalizeMimeType("")).toBe("application/octet-stream");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublishPage, UploadResultsList, capabilityUrlText } from "../publisher/ui/publish-page.js";
import type { UploadSummary } from "../src/protected-data.js";

const uploads: UploadSummary[] = [
  {
    id: "a".repeat(32),
    kind: "file",
    filename: "notes.txt",
    contentType: "text/plain",
    url: `https://tools.example.test/files/${"a".repeat(32)}/notes.txt`,
    bytes: 1024,
    updatedAt: "2026-08-28T12:00:00.000Z",
    expiresAt: "2026-08-31T12:00:00.000Z"
  },
  {
    id: "b".repeat(32),
    kind: "file",
    filename: "report.pdf",
    contentType: "application/pdf",
    url: `https://tools.example.test/files/${"b".repeat(32)}/report.pdf`,
    bytes: 2048,
    updatedAt: "2026-08-28T12:01:00.000Z",
    expiresAt: "2026-08-31T12:01:00.000Z"
  }
];

describe("Publisher upload page", () => {
  it("allows more than one file to be selected", () => {
    const html = renderToStaticMarkup(<PublishPage />);

    expect(html).toContain('type="file"');
    expect(html).toContain('multiple=""');
    expect(html).toContain("Drop files here");
    expect(html).toContain("Choose files");
  });

  it("renders every uploaded file and one copy-all action", () => {
    const html = renderToStaticMarkup(<UploadResultsList results={uploads} onCopyAll={() => undefined} onCopy={() => undefined} />);

    expect(html).toContain("Uploaded files (2)");
    expect(html).toContain("notes.txt");
    expect(html).toContain("report.pdf");
    expect(html).toContain("Copy all URLs");
    expect(html.match(/Copy URL/g)).toHaveLength(2);
  });

  it("formats all capability URLs as newline-separated clipboard text", () => {
    expect(capabilityUrlText(uploads)).toBe(`${uploads[0]!.url}\n${uploads[1]!.url}`);
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DocumentsPage, filterDocuments } from "../dashboard/ui/documents-page.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = Date.UTC(2026, 7, 4, 12);
const documents = [
  { token: "a".repeat(24), filename: "recent.md", createdAt: now - 1_000, updatedAt: now - 1_000, expiresAt: now + HOUR, checkpointCount: 2 },
  { token: "b".repeat(24), filename: "older.md", createdAt: now - 4 * DAY, updatedAt: now - 3.5 * DAY, expiresAt: now + 3.5 * DAY, checkpointCount: 0 },
  // Pinned: the expiry is 30 days after the last edit.
  { token: "c".repeat(24), filename: "pinned.md", createdAt: now - 5 * DAY, updatedAt: now - 2 * DAY, expiresAt: now + 28 * DAY, checkpointCount: 3 }
];
const page = { actor: "operator@example.test", publicOrigin: "https://markdown.example.test", generatedAt: now, documents, truncated: false };

function row(html: string, filename: string) {
  return html.split("<tr").find((part) => part.includes(`>${filename}<`)) ?? "";
}

describe("DocumentsPage", () => {
  it("renders the header facts and the document table", () => {
    const html = renderToStaticMarkup(<DocumentsPage initial={page} />);
    expect(html).toContain("3 active · 1 edited today · next expiry in 1 h");
    expect(html).toContain('data-slot="table"');
    expect(html).toContain("New document");
    expect(html).toContain('href="https://markdown.example.test/markdown"');
    expect(html).toContain('href="https://markdown.example.test/markdown/d/recent.md--aaaaaaaaaaaaaaaaaaaaaaaa"');
    expect(html).toContain("Documents expire 7 days after the last edit, or 30 days when pinned.");
    expect(html).toContain('data-suite-accent="rose"');
    expect(html).not.toContain("operator@example.test");
  });

  it("counts the filter chips over the loaded documents", () => {
    const html = renderToStaticMarkup(<DocumentsPage initial={page} />);
    expect(html).toMatch(/Expires within 24 h<b[^>]*>1<\/b>/);
    expect(html).toMatch(/With checkpoints<b[^>]*>2<\/b>/);
  });

  it("shows time left as a share of 7 days, or 30 days when pinned", () => {
    const html = renderToStaticMarkup(<DocumentsPage initial={page} />);
    expect(row(html, "older.md")).toContain("width:50%");
    expect(row(html, "older.md")).not.toContain("· pinned");
    expect(row(html, "pinned.md")).toContain("· pinned");
    expect(row(html, "pinned.md")).toContain("width:93%");
    expect(row(html, "recent.md")).toContain("text-warning");
  });

  it("offers another server page when the inventory has a cursor", () => {
    const html = renderToStaticMarkup(<DocumentsPage initial={{ ...page, truncated: true, nextCursor: "next-page" }} />);
    expect(html).toContain("3+ active");
    expect(html).toContain("Load more");
    expect(html).toContain("Search and filters apply to loaded documents.");
  });

  it("applies the chip filters before sorting", () => {
    const names = (filters: Partial<Parameters<typeof filterDocuments>[2]>) => filterDocuments(documents, now, { query: "", expiringSoon: false, withCheckpoints: false, sort: "name-asc", ...filters }).map(({ filename }) => filename);
    expect(names({ expiringSoon: true })).toEqual(["recent.md"]);
    expect(names({ withCheckpoints: true })).toEqual(["pinned.md", "recent.md"]);
    expect(names({ withCheckpoints: true, sort: "expiry-asc" })).toEqual(["recent.md", "pinned.md"]);
    expect(names({ query: "OLD" })).toEqual(["older.md"]);
  });
});

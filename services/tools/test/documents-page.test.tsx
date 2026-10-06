import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DocumentsPage, MobileDocumentInventory, filterDocuments } from "../dashboard/ui/documents-page.js";

const now = Date.UTC(2026, 7, 4, 12);
const documents = [
  { token: "a".repeat(24), filename: "recent.md", createdAt: now - 1_000, updatedAt: now - 1_000, expiresAt: now + 3_600_000, checkpointCount: 2 },
  { token: "b".repeat(24), filename: "older.md", createdAt: now - 86_400_000, updatedAt: now - 43_200_000, expiresAt: now + 604_800_000, checkpointCount: 0 }
];

describe("DocumentsPage", () => {
  it("renders the task-focused inventory with shadcn table semantics", () => {
    const html = renderToStaticMarkup(<DocumentsPage initial={{ actor: "operator@example.test", publicOrigin: "https://markdown.example.test", generatedAt: now, documents, truncated: false }} />);
    expect(html).toContain(">Documents</h1>");
    expect(html).toContain('data-slot="table"');
    expect(html).toContain("recent.md");
    expect(html).toContain("New document");
    expect(html).toContain('aria-label="Select all visible documents"');
    expect(html).toContain("Expires within 24 h");
    expect(html).toContain('href="https://markdown.example.test/share"');
    expect(html).toContain('href="https://markdown.example.test/share/d/recent.md--aaaaaaaaaaaaaaaaaaaaaaaa"');
    expect(html).toContain('data-suite-accent="rose"');
  });

  it("offers another server page when the inventory has a cursor", () => {
    const html = renderToStaticMarkup(<DocumentsPage initial={{ actor: "operator@example.test", publicOrigin: "https://markdown.example.test", generatedAt: now, documents, truncated: true, nextCursor: "next-page" }} />);
    expect(html).toContain("Load more documents");
    expect(html).toContain("Search and filters apply to loaded documents.");
  });

  it("keeps every mobile document action visible in the focused record", () => {
    const html = renderToStaticMarkup(<MobileDocumentInventory documents={documents.slice(0, 1)} total={documents.length} generatedAt={now} publicOrigin="https://markdown.example.test" onCopy={() => undefined} onShowMore={() => undefined} />);
    expect(html).toContain('aria-label="Document inventory"');
    expect(html).toContain("Copy link");
    expect(html).toContain("Open");
    expect(html).toContain("Show 50 more");
  });

  it("filters checkpoints and expiry before sorting", () => {
    expect(filterDocuments(documents, now, { query: "recent", checkpoints: "with", expiry: "24", sort: "expiry-asc" }).map(({ filename }) => filename)).toEqual(["recent.md"]);
    expect(filterDocuments(documents, now, { query: "", checkpoints: "without", expiry: "all", sort: "name-asc" }).map(({ filename }) => filename)).toEqual(["older.md"]);
  });
});


it("filters both formats while retaining legacy Markdown records", () => {
  const latex = { ...documents[0]!, token: "c".repeat(24), filename: "paper.tex", format: "latex" as const };
  const filters = { query: "", checkpoints: "all" as const, expiry: "all" as const, sort: "name-asc" as const };
  expect(filterDocuments([...documents, latex], now, { ...filters, format: "latex" })).toEqual([latex]);
  expect(filterDocuments([...documents, latex], now, { ...filters, format: "markdown" })).toHaveLength(2);
});

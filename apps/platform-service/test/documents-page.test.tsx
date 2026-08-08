import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DocumentsPage, filterDocuments } from "../src/features/documents/documents-page.js";

const now = Date.UTC(2026, 7, 4, 12);
const documents = [
  { token: "a".repeat(24), filename: "recent.md", createdAt: now - 1_000, updatedAt: now - 1_000, expiresAt: now + 3_600_000, checkpointCount: 2 },
  { token: "b".repeat(24), filename: "older.md", createdAt: now - 86_400_000, updatedAt: now - 43_200_000, expiresAt: now + 604_800_000, checkpointCount: 0 }
];

describe("DocumentsPage", () => {
  it("renders the task-focused inventory with shadcn table semantics", () => {
    const html = renderToStaticMarkup(<DocumentsPage initial={{ actor: "operator@example.test", publicOrigin: "https://markdown.example.test", generatedAt: now, documents, truncated: false }} />);
    expect(html).toContain("Manage active documents.");
    expect(html).toContain('data-slot="table"');
    expect(html).toContain("recent.md");
    expect(html).toContain("New document");
  });

  it("filters checkpoints and expiry before sorting", () => {
    expect(filterDocuments(documents, now, { query: "recent", checkpoints: "with", expiry: "24", sort: "expiry-asc" }).map(({ filename }) => filename)).toEqual(["recent.md"]);
    expect(filterDocuments(documents, now, { query: "", checkpoints: "without", expiry: "all", sort: "name-asc" }).map(({ filename }) => filename)).toEqual(["older.md"]);
  });
});

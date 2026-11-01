import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { filterAndSortUploads, groupProjectsByUsage, ManagePage, type LifecycleFilter } from "../publisher/ui/manage-page.js";
import type { ManagePageData, UploadSummary } from "../src/protected-data.js";

const initial: ManagePageData = {
  summary: {
    total: 142,
    permanent: 92,
    temporary: 50,
    expiringSoon: 8,
    projects: [
      { project: "microservices", count: 41 },
      { project: null, count: 101 }
    ]
  },
  uploads: [
    {
      id: "a".repeat(32),
      kind: "html",
      filename: "plan.html",
      contentType: "text/html; charset=utf-8",
      url: `https://tools.example.test/artifacts/${"a".repeat(32)}`,
      bytes: 4096,
      updatedAt: "2026-08-08T20:00:00.000Z",
      project: "microservices"
    },
    {
      id: "b".repeat(32),
      kind: "file",
      filename: "logs.txt",
      contentType: "text/plain",
      url: `https://tools.example.test/files/${"b".repeat(32)}/logs.txt`,
      bytes: 2048,
      updatedAt: "2026-08-08T19:00:00.000Z",
      expiresAt: "2099-08-09T10:00:00.000Z"
    }
  ]
};

describe("Publisher library", () => {
  it("renders the header facts, counted filter chips, sortable table and inspector", () => {
    const html = renderToStaticMarkup(<ManagePage initial={initial} />);

    expect(html).toContain("Library");
    expect(html).toContain("142 artifacts in 1 project");
    expect(html).toContain('aria-label="Refresh"');
    expect(html).toContain('href="/publisher"');
    expect(html).toMatch(/Expiring soon<b[^>]*>8<\/b>/);
    expect(html).toMatch(/Temporary<b[^>]*>50<\/b>/);
    expect(html).toMatch(/Permanent<b[^>]*>92<\/b>/);
    expect(html).toContain("microservices (41)");
    expect(html).toContain("Unassigned (101)");
    expect(html).toMatch(/aria-sort="descending"[^>]*><button[^>]*>Updated/);
    expect(html).toContain("plan.html");
    expect(html).toContain("logs.txt");
    expect(html).toContain("Persistent");
    expect(html).toContain("Replace file");
    expect(html).toContain("Revoke…");
    expect(html).toContain("2 of 142 shown · newest first");
    expect(html).toContain('data-suite-accent="violet"');
  });

  it("offers Change expiry for a selected file", () => {
    const html = renderToStaticMarkup(<ManagePage initial={{ uploads: initial.uploads.toReversed() }} />);

    expect(html).toContain("Change expiry");
    expect(html).toContain("d left ·");
    expect(html).not.toContain("Replace file");
  });

  it("labels files without an expiry as permanent", () => {
    const { expiresAt: _expiry, ...file } = initial.uploads[1]!;
    const html = renderToStaticMarkup(<ManagePage initial={{ uploads: [file] }} />);

    expect(html).toContain("Permanent · until revoked");
  });

  it("keeps search of older artifacts explicit and bounded", async () => {
    const source = await readFile(new URL("../publisher/ui/manage-page.tsx", import.meta.url), "utf8");
    const completeLibrary = source.slice(source.indexOf("async function loadCompleteLibrary"), source.indexOf("async function replaceSelected"));
    expect(completeLibrary).toContain("while (cursor)");
    expect(completeLibrary).toContain("remaining.push(...payload.uploads)");
    expect(completeLibrary).toContain("if (!nextCursor || loadingAllRef.current) return;");
    expect(source).toContain("Search remaining artifacts");
    expect(source).toContain("No matches in loaded artifacts");
    expect(source).toContain("const selected = visibleUploads.find((upload) => upload.id === selectedId)");
    expect(source).not.toContain("void loadCompleteLibrary();");
  });

  it("preserves loaded pages while updating rows and exact summaries", async () => {
    const source = await readFile(new URL("../publisher/ui/manage-page.tsx", import.meta.url), "utf8");
    const lifecycleUpdates = source.slice(
      source.indexOf("async function changeProject"),
      source.indexOf("async function copyArtifactUrl")
    );

    expect(lifecycleUpdates).toContain("setUploads((current)");
    expect(lifecycleUpdates).toContain("await refreshSummary()");
    expect(lifecycleUpdates).not.toContain("await refresh()");
  });

  it("uses exact project usage boundaries and sorts each group by usage", () => {
    expect(groupProjectsByUsage([
      ["one", 1],
      ["two", 2],
      ["nine", 9],
      ["ten", 10],
      ["ninety-nine", 99],
      ["hundred", 100],
      ["powerhouse", 200]
    ])).toEqual([
      { label: "100+ uses", projects: [["powerhouse", 200], ["hundred", 100]] },
      { label: "10–99 uses", projects: [["ninety-nine", 99], ["ten", 10]] },
      { label: "2–9 uses", projects: [["nine", 9], ["two", 2]] },
      { label: "One-off projects", projects: [["one", 1]] }
    ]);
  });
});

describe("Library lifecycle chips", () => {
  const now = Date.parse("2026-09-27T10:00:00.000Z");
  const base = { contentType: "application/octet-stream", bytes: 1, updatedAt: "2026-09-26T10:00:00.000Z" };
  const uploads: UploadSummary[] = [
    { ...base, id: "plan", kind: "html", filename: "plan.html", url: "https://tools.example.test/artifacts/plan" },
    { ...base, id: "kept", kind: "file", filename: "kept.pdf", url: "https://tools.example.test/files/kept/kept.pdf" },
    { ...base, id: "soon", kind: "file", filename: "soon.pdf", url: "https://tools.example.test/files/soon/soon.pdf", expiresAt: "2026-09-27T20:00:00.000Z" },
    { ...base, id: "later", kind: "file", filename: "later.pdf", url: "https://tools.example.test/files/later/later.pdf", expiresAt: "2026-10-03T10:00:00.000Z" },
    { ...base, id: "gone", kind: "file", filename: "gone.pdf", url: "https://tools.example.test/files/gone/gone.pdf", expiresAt: "2026-09-27T09:00:00.000Z" }
  ];

  function ids(lifecycle: LifecycleFilter) {
    return filterAndSortUploads(uploads, { projectFilter: "__all__", query: "", kind: "all", lifecycle, sort: "filename" }, now).map(({ id }) => id);
  }

  it("matches the counts: soon is within 24 hours, temporary has an expiry, permanent has none", () => {
    expect(ids("soon")).toEqual(["soon"]);
    expect(ids("temporary")).toEqual(["gone", "later", "soon"]);
    expect(ids("permanent")).toEqual(["kept", "plan"]);
    expect(ids("all")).toHaveLength(5);
  });
});

import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { groupProjectsByUsage, ManagePage } from "../publisher/ui/manage-page.js";
import type { ManagePageData } from "../src/protected-data.js";

const initial: ManagePageData = {
  summary: {
    total: 142,
    activeBytes: 1073741824,
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
      category: "html",
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
      category: "documents",
      url: `https://tools.example.test/files/${"b".repeat(32)}/logs.txt`,
      bytes: 2048,
      updatedAt: "2026-08-08T19:00:00.000Z",
      expiresAt: "2026-08-09T10:00:00.000Z"
    }
  ]
};

describe("Manage artifact library", () => {
  it("renders a compact, selectable library with lifecycle and inspector actions", () => {
    const html = renderToStaticMarkup(<ManagePage initial={initial} />);

    expect(html).toContain(">Library</h1>");
    expect(html).toContain("microservices");
    expect(html).toContain("Unassigned");
    expect(html).toContain("plan.html");
    expect(html).toContain("logs.txt");
    expect(html).toContain("Persistent");
    expect(html).toContain("Replace file");
    expect(html).toContain("Copy URL");
    expect(html).toContain("Revoke artifact");
    expect(html).toContain("142 artifacts in 2 projects");
    expect(html).toContain('aria-label="Select all visible artifacts"');
    expect(html).toContain('aria-label="Select plan.html"');
    expect(html).toContain("2 of 142 loaded");
    expect(html).toContain("1.0 GB active storage");
    expect(html).toContain(">Size</th>");
    expect(html).toContain("4.0 KB");
    expect(html).toContain("2.0 KB");
    expect(html).toContain('aria-label="File category"');
    expect(html).toContain(">142<");
    expect(html).toContain('href="/publisher"');
    expect(html).toContain('data-suite-accent="violet"');
    expect(html).not.toContain("Tools architecture and monitoring");
  });

  it("shows the compact expiry control for a selected file", () => {
    const html = renderToStaticMarkup(<ManagePage initial={{ uploads: initial.uploads.toReversed() }} />);

    expect(html).toContain("File expiry");
    expect(html).toContain("Change");
    expect(html).toContain("left ·");
  });

  it("labels files without an expiry as permanent", () => {
    const { expiresAt: _expiry, ...file } = initial.uploads[1]!;
    const html = renderToStaticMarkup(<ManagePage initial={{ uploads: [file] }} />);

    expect(html).toContain("Permanent");
    expect(html).toContain("available until revoked");
  });

  it("offers separate PDF viewing and explicit download links", () => {
    const url = `https://tools.example.test/files/${"b".repeat(32)}/report.pdf`;
    const html = renderToStaticMarkup(<ManagePage initial={{ uploads: [{
      ...initial.uploads[1]!, filename: "report.pdf", contentType: "application/pdf", url,
      downloadUrl: `${url}?download=1`
    }] }} />);

    expect(html).toContain(`href="${url}"`);
    expect(html).toContain(`href="${url}?download=1"`);
    expect(html).toContain("Download</a>");
  });

  it("keeps the library and inspector in two columns with horizontal table overflow", async () => {
    const source = await readFile(new URL("../publisher/ui/manage-page.tsx", import.meta.url), "utf8");

    expect(source).toContain("lg:grid-cols-[minmax(0,1fr)_20rem]");
    expect(source).toContain('className="overflow-x-auto"');
    expect(source).toContain("onToggle={toggleSelection}");
  });

  it("keeps project usage in the compact project selector", () => {
    const html = renderToStaticMarkup(<ManagePage initial={{
      ...initial,
      summary: {
        ...initial.summary!,
        projects: [
          { project: "daily-driver", count: 100 },
          { project: "regular-work", count: 10 },
          { project: "small-project", count: 2 },
          { project: "single-time-plan", count: 1 }
        ]
      }
    }} />);

    expect(html).toContain('aria-label="Project"');
    expect(html).toContain("All projects");
    expect(html).toContain("142 artifacts in 4 projects");
    expect(html).toContain('label="100+ uses"');
    expect(html).toContain('label="One-off projects"');
    expect(html).not.toContain("Show one-off projects");
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

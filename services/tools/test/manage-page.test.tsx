import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { groupProjectsByUsage, ManagePage } from "../publisher/ui/manage-page.js";
import type { ManagePageData } from "../src/protected-data.js";

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
      expiresAt: "2026-08-09T10:00:00.000Z"
    }
  ]
};

describe("Manage artifact library", () => {
  it("renders project navigation, lifecycle state, and selected artifact actions", () => {
    const html = renderToStaticMarkup(<ManagePage initial={initial} />);

    expect(html).toContain("Maintain every plan and file shared through Publish.");
    expect(html).toContain("microservices");
    expect(html).toContain("Unassigned");
    expect(html).toContain("plan.html");
    expect(html).toContain("logs.txt");
    expect(html).toContain("Persistent");
    expect(html).toContain("Replace file");
    expect(html).toContain("Copy URL");
    expect(html).toContain("Revoke artifact");
    expect(html).toContain("Total artifacts");
    expect(html).toContain("2 of 142 loaded");
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

  it("loads remaining inventory pages before applying a summarized project filter", async () => {
    const source = await readFile(new URL("../publisher/ui/manage-page.tsx", import.meta.url), "utf8");
    const completeLibrary = source.slice(source.indexOf("async function loadCompleteLibrary"), source.indexOf("async function replaceSelected"));
    expect(completeLibrary).toContain("while (cursor)");
    expect(completeLibrary).toContain("remaining.push(...payload.uploads)");
    expect(completeLibrary).toContain("if (busy) return;");
    expect(source).toContain("onSelect={(value) => void selectProject(value)}");
    expect(source).toContain("void loadCompleteLibrary();");
    expect(source).toContain("disabled={busy}");
  });

  it("preserves loaded pages while updating rows and exact summaries", async () => {
    const source = await readFile(new URL("../publisher/ui/manage-page.tsx", import.meta.url), "utf8");
    const lifecycleUpdates = source.slice(
      source.indexOf("async function changeProject"),
      source.indexOf("async function copySelectedUrl")
    );

    expect(lifecycleUpdates).toContain("setUploads((current)");
    expect(lifecycleUpdates).toContain("await refreshSummary()");
    expect(lifecycleUpdates).not.toContain("await refresh()");
  });

  it("widens the desktop project navigation for full repository names", async () => {
    const source = await readFile(new URL("../publisher/ui/manage-page.tsx", import.meta.url), "utf8");

    expect(source).toContain("lg:grid-cols-[16rem_minmax(0,1fr)_20rem]");
    expect(source).toContain("xl:grid-cols-[24rem_minmax(0,1fr)_20rem]");
  });

  it("groups projects by usage and hides one-off projects by default", () => {
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

    expect(html).toContain("100+ uses");
    expect(html).toContain("10–99 uses");
    expect(html).toContain("2–9 uses");
    expect(html).toContain("daily-driver");
    expect(html).toContain("regular-work");
    expect(html).toContain("small-project");
    expect(html).toContain("Show one-off projects");
    expect(html).not.toContain(">single-time-plan</span>");
    expect(html).toContain('aria-expanded="false"');
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

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ManagePage } from "../publisher/ui/manage-page.js";
import type { ManagePageData } from "../src/protected-data.js";

const initial: ManagePageData = {
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
    expect(html).toContain('href="/publisher"');
    expect(html).toContain('data-suite-accent="violet"');
    expect(html).not.toContain("Tools architecture and monitoring");
  });
});

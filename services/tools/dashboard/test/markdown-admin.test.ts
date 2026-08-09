import { describe, expect, it } from "vitest";
import {
  createMarkdownAdminClient,
  decodeMarkdownAdminSnapshot,
  MarkdownAdminUnavailableError
} from "../src/markdown-admin.js";
import { renderMarkdownAdminPage } from "../src/ui/markdown-admin-page.js";

const snapshot = {
  generatedAt: 1_000,
  truncated: false,
  documents: [
    {
      token: "j57dzxnpat8g9sbksewde1dznh8bczet",
      filename: "notes.md",
      createdAt: 100,
      updatedAt: 900,
      expiresAt: 2_000,
      checkpointCount: 3
    }
  ]
};

describe("Markdown admin client", () => {
  it("sends the service token only in the authorization header", async () => {
    let request: Request | undefined;
    const client = createMarkdownAdminClient({
      endpoint: "https://convex.example.test/admin/documents",
      token: "a".repeat(32),
      fetch: async (input, init) => {
        request = new Request(input, init);
        return Response.json(snapshot);
      }
    });

    await expect(client.list()).resolves.toEqual(snapshot);
    expect(request?.url).toBe("https://convex.example.test/admin/documents");
    expect(request?.headers.get("authorization")).toBe(
      `Bearer ${"a".repeat(32)}`
    );
  });

  it("rejects malformed or unsuccessful upstream responses", async () => {
    expect(() =>
      decodeMarkdownAdminSnapshot({
        ...snapshot,
        documents: [{ ...snapshot.documents[0], token: "guessable" }]
      })
    ).toThrow(MarkdownAdminUnavailableError);

    const client = createMarkdownAdminClient({
      endpoint: "https://convex.example.test/admin/documents",
      token: "a".repeat(32),
      fetch: async () => Response.json({ error: "unauthorized" }, { status: 401 })
    });
    await expect(client.list()).rejects.toBeInstanceOf(
      MarkdownAdminUnavailableError
    );
  });
});

describe("Markdown document inventory page", () => {
  it("renders operational metrics and controls from the protected snapshot", () => {
    const now = Date.UTC(2026, 6, 29, 12);
    const html = renderMarkdownAdminPage({
      snapshot: {
        generatedAt: now,
        truncated: false,
        documents: [
          {
            token: "j57dzxnpat8g9sbksewde1dznh8bczet",
            filename: "recent-notes.md",
            createdAt: now - 2 * 60 * 60 * 1000,
            updatedAt: now - 30 * 60 * 1000,
            expiresAt: now + 12 * 60 * 60 * 1000,
            checkpointCount: 3
          },
          {
            token: "v7xz9ynpat8g9sbksewde1dznh8bczet",
            filename: "older-plan.md",
            createdAt: now - 4 * 24 * 60 * 60 * 1000,
            updatedAt: now - 2 * 24 * 60 * 60 * 1000,
            expiresAt: now + 3 * 24 * 60 * 60 * 1000,
            checkpointCount: 0
          }
        ]
      },
      actor: 'operator<admin@example.test>',
      publicOrigin: "https://markdown.example.test"
    });

    expect(html).toContain("Document inventory");
    expect(html).toContain("Edited in 24 hours");
    expect(html).toContain("Checkpoint versions");
    expect(html).toContain("3</strong>");
    expect(html).toContain("in 12h");
    expect(html).toContain("30m ago");
    expect(html).toContain("3 versions");
    expect(html).toContain("0 versions");
    expect(html).toContain("data-document-search");
    expect(html).toContain("data-document-sort");
    expect(html).toContain("data-copy-link");
    expect(html).toContain('<script src="/assets/markdown-admin.js?v=5e41cd2" defer></script>');
    expect(html).toContain("operator&lt;admin@example.test&gt;");
    expect(html).not.toContain("operator<admin@example.test>");
  });
});

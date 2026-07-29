import { describe, expect, it } from "vitest";
import {
  createMarkdownAdminClient,
  decodeMarkdownAdminSnapshot,
  MarkdownAdminUnavailableError
} from "../src/markdown-admin.js";

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

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
      format: "markdown",
      createdAt: 100,
      updatedAt: 900,
      expiresAt: 2_000,
      checkpointCount: 3
    }
  ]
};

describe("Markdown admin client", () => {
  it("accepts LaTeX metadata and defaults legacy Markdown responses", () => {
    const legacy = { ...snapshot.documents[0], format: undefined };
    expect(decodeMarkdownAdminSnapshot({ ...snapshot, documents: [legacy] }).documents[0]?.format).toBe("markdown");
    const latex = { ...legacy, filename: "paper.tex", format: "latex" };
    expect(decodeMarkdownAdminSnapshot({ ...snapshot, documents: [latex] }).documents[0]?.format).toBe("latex");
    expect(() => decodeMarkdownAdminSnapshot({ ...snapshot, documents: [{ ...latex, format: "markdown" }] })).toThrow(MarkdownAdminUnavailableError);
  });
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

  it("passes a private pagination cursor to the upstream inventory", async () => {
    let request: Request | undefined;
    const client = createMarkdownAdminClient({ endpoint: "https://convex.example.test/admin/documents", token: "a".repeat(32), fetch: async (input, init) => { request = new Request(input, init); return Response.json({ ...snapshot, truncated: true, nextCursor: "next-page" }); } });
    await expect(client.list("previous-page", 1_000)).resolves.toMatchObject({ nextCursor: "next-page" });
    expect(new URL(request!.url).searchParams.get("cursor")).toBe("previous-page");
    expect(new URL(request!.url).searchParams.get("asOf")).toBe("1000");
    expect(request?.headers.get("authorization")).toBe(`Bearer ${"a".repeat(32)}`);
  });
});

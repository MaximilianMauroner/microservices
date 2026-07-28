import { describe, expect, it } from "vitest";
import {
  documentPath,
  formatExpiry,
  markdownFromJson,
  normalizeFilename,
  parseDocumentRoute,
} from "./lib";

const TOKEN = "81f2a9dd-9ca3-4e4c-9d30-13d3f50dcf3b";

describe("document links", () => {
  it("normalizes names into safe Markdown filenames", () => {
    expect(normalizeFilename("  Résumé / Notes.MD ")).toBe("resume-notes.md");
    expect(normalizeFilename("!!!")).toBe("untitled.md");
  });

  it("round-trips a canonical capability route", () => {
    const path = documentPath("project-notes.md", TOKEN);
    expect(parseDocumentRoute(path)).toEqual({
      filename: "project-notes.md",
      token: TOKEN,
    });
  });

  it("accepts a server-generated Convex capability postfix", () => {
    const token = "j57dzxnpat8g9sbksewde1dznh8bczet";
    expect(parseDocumentRoute(documentPath("server.md", token))).toEqual({
      filename: "server.md",
      token,
    });
  });

  it("rejects missing and non-v4 tokens", () => {
    expect(parseDocumentRoute("/d/notes.md--guessable")).toBeNull();
    expect(
      parseDocumentRoute(
        "/d/notes.md--81f2a9dd-9ca3-1e4c-9d30-13d3f50dcf3b",
      ),
    ).toBeNull();
  });
});

describe("document presentation", () => {
  it("extracts literal Markdown from the single code block", () => {
    expect(
      markdownFromJson({
        type: "doc",
        content: [
          { type: "codeBlock", content: [{ type: "text", text: "# Hi" }] },
        ],
      }),
    ).toBe("# Hi");
  });

  it("formats the seven day deadline compactly", () => {
    expect(formatExpiry(7 * 24 * 60 * 60 * 1000, 0)).toBe("7d 0h");
    expect(formatExpiry(90 * 60 * 1000, 0)).toBe("1h 30m");
  });
});

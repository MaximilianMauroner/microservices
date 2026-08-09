import { describe, expect, it } from "vitest";
import {
  MAX_RECENT_DOCUMENTS,
  parseRecentDocuments,
  upsertRecentDocument,
  type RecentDocument,
} from "./recent-documents";

const FIRST_TOKEN = "81f2a9dd-9ca3-4e4c-9d30-13d3f50dcf3b";
const SECOND_TOKEN = "j57dzxnpat8g9sbksewde1dznh8bczet";

describe("recent documents", () => {
  it("rejects corrupt storage and filters expired or invalid links", () => {
    expect(parseRecentDocuments("not json", 100)).toEqual([]);
    expect(
      parseRecentDocuments(
        JSON.stringify([
          {
            token: FIRST_TOKEN,
            filename: "active.md",
            expiresAt: 200,
            lastOpenedAt: 80,
          },
          {
            token: SECOND_TOKEN,
            filename: "expired.md",
            expiresAt: 100,
            lastOpenedAt: 90,
          },
          {
            token: "guessable",
            filename: "invalid.md",
            expiresAt: 300,
            lastOpenedAt: 95,
          },
        ]),
        100,
      ),
    ).toEqual([
      {
        token: FIRST_TOKEN,
        filename: "active.md",
        expiresAt: 200,
        lastOpenedAt: 80,
      },
    ]);
  });

  it("keeps the latest visit for each token and sorts recent first", () => {
    const documents: RecentDocument[] = [
      {
        token: FIRST_TOKEN,
        filename: "old-name.md",
        expiresAt: 500,
        lastOpenedAt: 100,
      },
      {
        token: SECOND_TOKEN,
        filename: "second.md",
        expiresAt: 500,
        lastOpenedAt: 200,
      },
    ];
    const updated = upsertRecentDocument(
      documents,
      {
        token: FIRST_TOKEN,
        filename: "renamed.md",
        expiresAt: 600,
        lastOpenedAt: 300,
      },
      0,
    );

    expect(updated.map(({ filename }) => filename)).toEqual([
      "renamed.md",
      "second.md",
    ]);
  });

  it("caps the locally stored list", () => {
    const documents = Array.from(
      { length: MAX_RECENT_DOCUMENTS + 10 },
      (_, index): RecentDocument => ({
        token: `${index.toString().padStart(20, "0")}abcd`,
        filename: `${index}.md`,
        expiresAt: 1_000,
        lastOpenedAt: index,
      }),
    );

    expect(upsertRecentDocument(documents, documents[0]!, 0)).toHaveLength(
      MAX_RECENT_DOCUMENTS,
    );
  });
});

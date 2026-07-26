import type { RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { MemoryReviewRepository } from "../src/memory-repository.js";
import { decodeCursor, encodeCursor } from "../src/types.js";

const pass: RequestHandler = (_request, _response, next) => next();
const now = new Date("2026-07-26T00:00:00Z");

function setup() {
  const repository = new MemoryReviewRepository();
  const app = createApp({
    repository,
    agentAuth: pass,
    reviewerAuth: pass,
    publicBaseUrl: "https://reviews.example",
    now: () => now,
  });
  return { app, repository };
}

describe("opaque cursor validation", () => {
  it("accepts canonical base64url decimal cursors only", () => {
    expect(decodeCursor(encodeCursor("123"))).toBe("123");
    for (const cursor of ["", "MA==", encodeCursor("01"), encodeCursor("x"), "***"])
      expect(() => decodeCursor(cursor)).toThrow("Invalid cursor.");
  });

  it("returns HTTP 400 consistently for malformed history cursors", async () => {
    const { app } = setup();
    for (const cursor of ["", "MA==", encodeCursor("01"), "***"]) {
      const response = await request(app).get(
        `/api/review/history?cursor=${encodeURIComponent(cursor)}`,
      );
      expect(response.status, cursor).toBe(400);
      expect(response.body).toMatchObject({ error: "invalid_request" });
    }
    expect(
      (
        await request(app).get(
          `/api/review/history?cursor=${encodeCursor("1")}&cursor=${encodeCursor("2")}`,
        )
      ).status,
    ).toBe(400);
    expect((await request(app).get("/api/agent/decisions?cursor=")).status).toBe(400);
  });

  it("uses the same canonical cursor semantics in the memory repository", async () => {
    const { repository } = setup();
    await expect(repository.history("MA==", 10)).rejects.toThrow(
      "Invalid cursor.",
    );
    await expect(repository.decisions(encodeCursor("01"), 10)).rejects.toThrow(
      "Invalid cursor.",
    );
    await expect(repository.history(encodeCursor("1"), 10)).resolves.toMatchObject({
      decisions: [],
      hasMore: false,
    });
  });
});

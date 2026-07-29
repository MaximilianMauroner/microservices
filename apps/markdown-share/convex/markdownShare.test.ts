import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import prosemirrorTest from "@convex-dev/prosemirror-sync/test";
import presenceTest from "@convex-dev/presence/test";
import schema from "./schema";
import { api, components, internal } from "./_generated/api";
import { MAX_MARKDOWN_LENGTH, RETENTION_MS } from "./constants";

const modules = import.meta.glob(["./**/*.ts", "!./**/*.test.ts"]);
const LEGACY_TOKEN = "81f2a9dd-9ca3-4e4c-9d30-13d3f50dcf3b";

function setup() {
  const test = convexTest(schema, modules);
  prosemirrorTest.register(test);
  presenceTest.register(test);
  return test;
}

function snapshot(markdown: string): string {
  return JSON.stringify({
    type: "doc",
    content: [
      {
        type: "codeBlock",
        attrs: { language: null },
        content: markdown ? [{ type: "text", text: markdown }] : undefined,
      },
    ],
  });
}

function insertStep(markdown: string, text: string): string {
  const position = markdown.length + 1;
  return JSON.stringify({
    stepType: "replace",
    from: position,
    to: position,
    slice: { content: [{ type: "text", text }] },
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("capability lifecycle", () => {
  it("generates new capabilities on the server", async () => {
    vi.useFakeTimers({ now: 1_000 });
    const test = setup();

    const first = await test.mutation(api.documents.create, {
      filename: "first.md",
      markdown: "# First",
    });
    const second = await test.mutation(api.documents.create, {
      filename: "second.md",
      markdown: "# Second",
    });

    expect(first.token).not.toBe(second.token);
    expect(first.token.length).toBeGreaterThanOrEqual(20);
    const claims = await test.run(async (ctx) => {
      return await ctx.db.query("capabilityClaims").collect();
    });
    const seeds = await test.run(async (ctx) => {
      return await ctx.db.query("capabilitySeeds").collect();
    });
    expect(claims).toEqual([]);
    expect(seeds).toEqual([]);
  });

  it("does not tombstone server capabilities during backfill or cleanup", async () => {
    vi.useFakeTimers({ now: 1_500 });
    const test = setup();
    const created = await test.mutation(api.documents.create, {
      filename: "server-cleanup.md",
      markdown: "server generated",
    });

    await test.mutation(internal.claims.backfill, {});
    expect(
      await test.run(async (ctx) => {
        return await ctx.db.query("capabilityClaims").collect();
      }),
    ).toEqual([]);

    vi.setSystemTime(created.expiresAt);
    await test.mutation(internal.cleanup.expire, {
      token: created.token,
      expectedExpiresAt: created.expiresAt,
    });
    expect(
      await test.run(async (ctx) => {
        return await ctx.db.query("capabilityClaims").collect();
      }),
    ).toEqual([]);
  });

  it("never allows a legacy capability to be reused after cleanup", async () => {
    vi.useFakeTimers({ now: 2_000 });
    const test = setup();
    const created = await test.mutation(api.documents.create, {
      filename: "legacy.md",
      markdown: "legacy",
      token: LEGACY_TOKEN,
    });

    vi.setSystemTime(created.expiresAt);
    await test.mutation(internal.cleanup.expire, {
      token: created.token,
      expectedExpiresAt: created.expiresAt,
    });

    await expect(
      test.mutation(api.documents.create, {
        filename: "legacy-again.md",
        markdown: "new content",
        token: LEGACY_TOKEN,
      }),
    ).rejects.toThrow("already been used");
    const claims = await test.run(async (ctx) => {
      return await ctx.db.query("capabilityClaims").collect();
    });
    expect(claims).toMatchObject([
      { token: LEGACY_TOKEN, kind: "legacy" },
    ]);
  });
});

describe("checkpoint history", () => {
  it("stores lightweight metadata and compares two immutable snapshots", async () => {
    vi.useFakeTimers({ now: 5_000 });
    const test = setup();
    const created = await test.mutation(api.documents.create, {
      filename: "history.md",
      markdown: "one\ntwo\n",
    });

    const older = await test.mutation(api.checkpoints.create, {
      token: created.token,
      markdown: "one\ntwo\n",
      createdBy: "Amber Fox 12",
    });
    vi.setSystemTime(6_000);
    const newer = await test.mutation(api.checkpoints.create, {
      token: created.token,
      markdown: "one\nthree\n",
      createdBy: "Blue Finch 07",
    });

    expect(
      await test.query(api.checkpoints.list, { token: created.token }),
    ).toEqual([
      { ...newer, charCount: 10 },
      { ...older, charCount: 8 },
    ]);
    expect(
      await test.query(api.checkpoints.compare, {
        token: created.token,
        olderId: older._id,
        newerId: newer._id,
      }),
    ).toEqual({
      older: {
        _id: older._id,
        createdAt: older.createdAt,
        createdBy: older.createdBy,
        markdown: "one\ntwo\n",
      },
      newer: {
        _id: newer._id,
        createdAt: newer.createdAt,
        createdBy: newer.createdBy,
        markdown: "one\nthree\n",
      },
    });
  });

  it("deletes checkpoint metadata and content with the document", async () => {
    vi.useFakeTimers({ now: 7_000 });
    const test = setup();
    const created = await test.mutation(api.documents.create, {
      filename: "temporary-history.md",
      markdown: "temporary",
    });
    await test.mutation(api.checkpoints.create, {
      token: created.token,
      markdown: "temporary",
      createdBy: "Cedar Otter 31",
    });

    vi.setSystemTime(created.expiresAt);
    await test.mutation(internal.cleanup.expire, {
      token: created.token,
      expectedExpiresAt: created.expiresAt,
    });

    const remaining = await test.run(async (ctx) => ({
      checkpoints: await ctx.db.query("checkpoints").collect(),
      contents: await ctx.db.query("checkpointContents").collect(),
    }));
    expect(remaining).toEqual({ checkpoints: [], contents: [] });
  });
});

describe("private admin inventory", () => {
  it("lists only active documents with checkpoint counts and newest edits first", async () => {
    vi.useFakeTimers({ now: 10_000 });
    const test = setup();
    const older = await test.mutation(api.documents.create, {
      filename: "older.md",
      markdown: "old",
    });
    await test.mutation(api.checkpoints.create, {
      token: older.token,
      markdown: "old",
      createdBy: "Amber Fox 12",
    });
    vi.setSystemTime(20_000);
    const newer = await test.mutation(api.documents.create, {
      filename: "newer.md",
      markdown: "new",
    });

    expect(
      await test.query(internal.admin.listActiveDocuments, {
        now: 20_000,
        limit: 10,
      }),
    ).toEqual({
      documents: [
        {
          token: newer.token,
          filename: "newer.md",
          createdAt: 20_000,
          updatedAt: 20_000,
          expiresAt: 20_000 + RETENTION_MS,
          checkpointCount: 0,
        },
        {
          token: older.token,
          filename: "older.md",
          createdAt: 10_000,
          updatedAt: 10_000,
          expiresAt: 10_000 + RETENTION_MS,
          checkpointCount: 1,
        },
      ],
      truncated: false,
    });

    expect(
      await test.query(internal.admin.listActiveDocuments, {
        now: newer.expiresAt,
        limit: 10,
      }),
    ).toEqual({ documents: [], truncated: false });
  });

  it("caps inventory reads", async () => {
    const test = setup();
    await expect(
      test.query(internal.admin.listActiveDocuments, {
        now: 0,
        limit: 201,
      }),
    ).rejects.toThrow("between 1 and 200");
  });
});

describe("editor protocol and retention", () => {
  it("schedules one expiry transition at document creation", async () => {
    vi.useFakeTimers({ now: 8_000 });
    const test = setup();
    const created = await test.mutation(api.documents.create, {
      filename: "scheduled-expiry.md",
      markdown: "temporary",
    });

    const scheduled = await test.run(async (ctx) =>
      await ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(scheduled).toMatchObject([
      {
        name: "cleanup:expire",
        scheduledTime: created.expiresAt,
        args: [{ token: created.token }],
        state: { kind: "pending" },
      },
    ]);

    await test.finishAllScheduledFunctions(() => vi.runAllTimers());
    await expect(
      test.query(api.documents.get, { token: created.token }),
    ).resolves.toBeNull();
    await expect(
      test.query(api.editor.getSnapshot, { id: created.token }),
    ).rejects.toThrow("expired");
  });

  it("keeps reads database-driven until the expiry transition", async () => {
    vi.useFakeTimers({ now: 9_000 });
    const test = setup();
    const created = await test.mutation(api.documents.create, {
      filename: "expired-reads.md",
      markdown: "temporary",
    });
    const older = await test.mutation(api.checkpoints.create, {
      token: created.token,
      markdown: "older",
      createdBy: "Amber Fox 12",
    });
    const newer = await test.mutation(api.checkpoints.create, {
      token: created.token,
      markdown: "newer",
      createdBy: "Blue Finch 07",
    });

    vi.setSystemTime(created.expiresAt);

    await expect(
      test.query(api.documents.get, { token: created.token }),
    ).resolves.not.toBeNull();
    await expect(
      test.query(api.checkpoints.list, { token: created.token }),
    ).resolves.toHaveLength(2);

    await test.mutation(internal.cleanup.expire, {
      token: created.token,
      expectedExpiresAt: created.expiresAt,
    });

    await expect(
      test.query(api.documents.get, { token: created.token }),
    ).resolves.toBeNull();
    await expect(
      test.query(api.editor.getSnapshot, { id: created.token }),
    ).rejects.toThrow("expired");
    await expect(
      test.query(api.editor.latestVersion, { id: created.token }),
    ).rejects.toThrow("expired");
    await expect(
      test.query(api.editor.getSteps, { id: created.token, version: 1 }),
    ).rejects.toThrow("expired");
    await expect(
      test.query(api.checkpoints.list, { token: created.token }),
    ).rejects.toThrow("expired");
    await expect(
      test.query(api.checkpoints.compare, {
        token: created.token,
        olderId: older._id,
        newerId: newer._id,
      }),
    ).rejects.toThrow("expired");
  });

  it("extends expiry and reschedules once at the previous deadline", async () => {
    vi.useFakeTimers({ now: 10_000 });
    const test = setup();
    const markdown = "hello";
    const created = await test.mutation(api.documents.create, {
      filename: "expiry.md",
      markdown,
    });
    const oldDeadline = created.expiresAt;

    vi.advanceTimersByTime(15_000);
    await expect(
      test.mutation(api.editor.submitSteps, {
        id: created.token,
        version: 1,
        clientId: "test-client",
        steps: [insertStep(markdown, "!")],
      }),
    ).resolves.toEqual({ status: "synced" });

    const extended = await test.query(api.documents.get, {
      token: created.token,
    });
    expect(extended?.expiresAt).toBe(25_000 + RETENTION_MS);
    const scheduledBeforeDeadline = await test.run(async (ctx) =>
      await ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(
      scheduledBeforeDeadline.filter((job) => job.state.kind === "pending"),
    ).toHaveLength(1);

    vi.advanceTimersByTime(oldDeadline - 25_000);
    await test.finishInProgressScheduledFunctions();
    expect(
      await test.query(api.documents.get, { token: created.token }),
    ).not.toBeNull();
    const scheduledAfterDeadline = await test.run(async (ctx) =>
      await ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(
      scheduledAfterDeadline.filter((job) => job.state.kind === "pending"),
    ).toMatchObject([
      {
        name: "cleanup:expire",
        scheduledTime: extended?.expiresAt,
        args: [{ token: created.token }],
      },
    ]);

    vi.advanceTimersByTime((extended?.expiresAt ?? oldDeadline) - oldDeadline);
    await test.finishInProgressScheduledFunctions();
    await expect(
      test.query(api.documents.get, { token: created.token }),
    ).resolves.toBeNull();
  });

  it("rejects expired edits and removes metadata, sync data, and presence", async () => {
    vi.useFakeTimers({ now: 30_000 });
    const test = setup();
    const created = await test.mutation(api.documents.create, {
      filename: "cleanup.md",
      markdown: "clean me",
    });
    const session = await test.mutation(api.presence.heartbeat, {
      roomId: created.token,
      userId: "per-tab-id",
      sessionId: "session-id",
      interval: 10_000,
    });
    await test.mutation(api.presence.setDisplayName, {
      roomId: created.token,
      userId: "per-tab-id",
      name: "Amber Fox 12",
    });
    expect(
      await test.query(api.presence.list, { roomToken: session.roomToken }),
    ).toMatchObject([{ userId: "per-tab-id", name: "Amber Fox 12" }]);

    vi.setSystemTime(created.expiresAt + 1);
    await test.mutation(internal.cleanup.expire, {
      token: created.token,
      expectedExpiresAt: created.expiresAt,
    });
    await expect(
      test.mutation(api.editor.submitSteps, {
        id: created.token,
        version: 1,
        clientId: "test-client",
        steps: [insertStep("clean me", "!")],
      }),
    ).rejects.toThrow("expired");

    expect(
      await test.query(api.documents.get, { token: created.token }),
    ).toBeNull();
    expect(
      await test.query(components.prosemirrorSync.lib.getSnapshot, {
        id: created.token,
      }),
    ).toEqual({ content: null });
    expect(
      await test.query(components.presence.public.list, {
        roomToken: session.roomToken,
      }),
    ).toEqual([]);
  });

  it("rejects malformed and history-poisoning snapshots", async () => {
    vi.useFakeTimers({ now: 40_000 });
    const test = setup();
    const created = await test.mutation(api.documents.create, {
      filename: "snapshot.md",
      markdown: "safe",
    });

    await expect(
      test.mutation(api.editor.submitSnapshot, {
        id: created.token,
        version: 1,
        content: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph" }],
        }),
      }),
    ).rejects.toThrow("exactly one code block");
    await expect(
      test.mutation(api.editor.submitSnapshot, {
        id: created.token,
        version: 1,
        content: snapshot("different but structurally valid"),
      }),
    ).rejects.toThrow("does not match");
    await expect(
      test.mutation(api.editor.submitSnapshot, {
        id: created.token,
        version: 1,
        content: snapshot("x".repeat(MAX_MARKDOWN_LENGTH + 1)),
      }),
    ).rejects.toThrow("500,000");
  });

  it("parses and applies steps before accepting them", async () => {
    vi.useFakeTimers({ now: 50_000 });
    const test = setup();
    const created = await test.mutation(api.documents.create, {
      filename: "steps.md",
      markdown: "safe",
    });

    await expect(
      test.mutation(api.editor.submitSteps, {
        id: created.token,
        version: 1,
        clientId: "test-client",
        steps: [JSON.stringify({ stepType: "future-step" })],
      }),
    ).rejects.toThrow("cannot be applied");
    await expect(
      test.mutation(api.editor.submitSteps, {
        id: created.token,
        version: 1,
        clientId: "test-client",
        steps: [
          JSON.stringify({
            stepType: "replace",
            from: 999,
            to: 999,
            slice: { content: [{ type: "text", text: "bad" }] },
          }),
        ],
      }),
    ).rejects.toThrow("cannot be applied");
    await expect(
      test.mutation(api.editor.submitSteps, {
        id: created.token,
        version: 1,
        clientId: "test-client",
        steps: [
          JSON.stringify({
            stepType: "attr",
            pos: 0,
            attr: "language",
            value: "javascript",
          }),
        ],
      }),
    ).rejects.toThrow("Code block attributes are not supported");
  });

  it("rejects a valid step whose result exceeds the Markdown limit", async () => {
    vi.useFakeTimers({ now: 60_000 });
    const test = setup();
    const markdown = "x".repeat(MAX_MARKDOWN_LENGTH);
    const created = await test.mutation(api.documents.create, {
      filename: "size.md",
      markdown,
    });

    await expect(
      test.mutation(api.editor.submitSteps, {
        id: created.token,
        version: 1,
        clientId: "test-client",
        steps: [insertStep(markdown, "!")],
      }),
    ).rejects.toThrow("500,000");
  });
});

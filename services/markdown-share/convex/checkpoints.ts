import { ConvexError, v } from "convex/values";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import {
  MAX_CHECKPOINT_AUTHOR_LENGTH,
  MAX_CHECKPOINTS,
} from "./constants";
import { requireLiveDocument } from "./documentLifecycle";
import { markdownAtVersion } from "./protocol";

const checkpointSummary = v.object({
  _id: v.id("checkpoints"),
  createdAt: v.number(),
  createdBy: v.string(),
  charCount: v.number(),
  version: v.optional(v.number()),
});

const checkpointWithContent = v.object({
  _id: v.id("checkpoints"),
  createdAt: v.number(),
  createdBy: v.string(),
  markdown: v.string(),
  version: v.optional(v.number()),
});

function invalidCheckpoint(message: string): ConvexError<{
  code: "INVALID_CHECKPOINT";
  message: string;
}> {
  return new ConvexError({ code: "INVALID_CHECKPOINT", message });
}

function optionalVersion(version: number | undefined): { version?: number } {
  return version === undefined ? {} : { version };
}

export const create = mutation({
  args: {
    token: v.string(),
    createdBy: v.string(),
  },
  returns: checkpointSummary,
  handler: async (ctx, args) => {
    const document = await requireLiveDocument(ctx, args.token);
    const createdBy = args.createdBy.trim();
    if (
      createdBy.length === 0 ||
      createdBy.length > MAX_CHECKPOINT_AUTHOR_LENGTH
    ) {
      throw invalidCheckpoint("Checkpoint author must contain 1 to 48 characters.");
    }

    const existing = await ctx.db
      .query("checkpoints")
      .withIndex("by_document_and_created_at", (index) =>
        index.eq("documentId", document._id),
      )
      .take(MAX_CHECKPOINTS);
    if (existing.length >= MAX_CHECKPOINTS) {
      throw new ConvexError({
        code: "CHECKPOINT_LIMIT_REACHED",
        message: `This document already has ${MAX_CHECKPOINTS} checkpoints.`,
      });
    }

    const version = await ctx.runQuery(
      components.prosemirrorSync.lib.latestVersion,
      { id: args.token },
    );
    if (version === null) {
      throw invalidCheckpoint("Editor history is unavailable.");
    }
    const markdown = await markdownAtVersion(ctx, args.token, version);

    const createdAt = Date.now();
    const contentId = await ctx.db.insert("checkpointContents", {
      markdown,
    });
    const checkpointId = await ctx.db.insert("checkpoints", {
      documentId: document._id,
      contentId,
      createdAt,
      createdBy,
      charCount: markdown.length,
      version,
    });

    return {
      _id: checkpointId,
      createdAt,
      createdBy,
      charCount: markdown.length,
      version,
    };
  },
});

export const list = query({
  args: { token: v.string() },
  returns: v.array(checkpointSummary),
  handler: async (ctx, args) => {
    const document = await requireLiveDocument(ctx, args.token);
    const checkpoints = await ctx.db
      .query("checkpoints")
      .withIndex("by_document_and_created_at", (index) =>
        index.eq("documentId", document._id),
      )
      .order("desc")
      .take(MAX_CHECKPOINTS);

    return checkpoints.map(
      ({ _id, createdAt, createdBy, charCount, version }) => ({
        _id,
        createdAt,
        createdBy,
        charCount,
        ...optionalVersion(version),
      }),
    );
  },
});

export const compare = query({
  args: {
    token: v.string(),
    olderId: v.id("checkpoints"),
    newerId: v.id("checkpoints"),
  },
  returns: v.object({
    older: checkpointWithContent,
    newer: checkpointWithContent,
  }),
  handler: async (ctx, args) => {
    const document = await requireLiveDocument(ctx, args.token);
    if (args.olderId === args.newerId) {
      throw invalidCheckpoint("Choose two different checkpoints.");
    }

    const [older, newer] = await Promise.all([
      ctx.db.get("checkpoints", args.olderId),
      ctx.db.get("checkpoints", args.newerId),
    ]);
    if (
      !older ||
      !newer ||
      older.documentId !== document._id ||
      newer.documentId !== document._id
    ) {
      throw invalidCheckpoint("A selected checkpoint is unavailable.");
    }

    const [olderContent, newerContent] = await Promise.all([
      ctx.db.get("checkpointContents", older.contentId),
      ctx.db.get("checkpointContents", newer.contentId),
    ]);
    if (!olderContent || !newerContent) {
      throw invalidCheckpoint("Checkpoint content is unavailable.");
    }

    return {
      older: {
        _id: older._id,
        createdAt: older.createdAt,
        createdBy: older.createdBy,
        markdown: olderContent.markdown,
        ...optionalVersion(older.version),
      },
      newer: {
        _id: newer._id,
        createdAt: newer.createdAt,
        createdBy: newer.createdBy,
        markdown: newerContent.markdown,
        ...optionalVersion(newer.version),
      },
    };
  },
});

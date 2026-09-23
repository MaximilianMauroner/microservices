import { ConvexError, v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { MAX_CHECKPOINTS } from "./constants";

const MAX_ADMIN_DOCUMENTS = 200;

const adminDocument = v.object({
  token: v.string(),
  filename: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  expiresAt: v.number(),
  checkpointCount: v.number(),
});

export const listActiveDocuments = internalQuery({
  args: {
    now: v.number(),
    limit: v.number(),
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    documents: v.array(adminDocument),
    truncated: v.boolean(),
    nextCursor: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    if (
      !Number.isSafeInteger(args.limit) ||
      args.limit < 1 ||
      args.limit > MAX_ADMIN_DOCUMENTS
    ) {
      throw new ConvexError({
        code: "INVALID_ADMIN_LIMIT",
        message: `Admin document limits must be between 1 and ${MAX_ADMIN_DOCUMENTS}.`,
      });
    }

    const page = await ctx.db
      .query("documents")
      .withIndex("by_expires_at", (index) => index.gt("expiresAt", args.now))
      .paginate({ numItems: args.limit, cursor: args.cursor ?? null });
    const documents = await Promise.all(
      page.page.map(async (document) => {
        const checkpoints = await ctx.db
          .query("checkpoints")
          .withIndex("by_document_and_created_at", (index) =>
            index.eq("documentId", document._id),
          )
          .take(MAX_CHECKPOINTS);
        return {
          token: document.token,
          filename: document.filename,
          createdAt: document.createdAt,
          updatedAt: document.updatedAt,
          expiresAt: document.expiresAt,
          checkpointCount: checkpoints.length,
        };
      }),
    );

    documents.sort(
      (left, right) =>
        right.updatedAt - left.updatedAt ||
        left.filename.localeCompare(right.filename),
    );
    return {
      documents,
      truncated: !page.isDone,
      ...(!page.isDone ? { nextCursor: page.continueCursor } : {}),
    };
  },
});

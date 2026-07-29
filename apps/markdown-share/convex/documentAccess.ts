import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { ConvexError } from "convex/values";

type ReadContext = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;

export async function findDocument(
  ctx: ReadContext,
  token: string,
): Promise<Doc<"documents"> | null> {
  return await ctx.db
    .query("documents")
    .withIndex("by_token", (query) => query.eq("token", token))
    .unique();
}

export async function requireLiveDocument(
  ctx: ReadContext,
  token: string,
): Promise<Doc<"documents">> {
  const document = await findDocument(ctx, token);
  if (!document) {
    throw new ConvexError({
      code: "DOCUMENT_UNAVAILABLE",
      message: "This document does not exist or has expired.",
    });
  }

  return document;
}

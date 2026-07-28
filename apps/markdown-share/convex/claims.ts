import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { ensureCapabilityClaim } from "./capabilities";

export const backfill = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const documents = await ctx.db.query("documents").take(500);
    for (const document of documents) {
      await ensureCapabilityClaim(ctx, document.token, document.createdAt);
    }
    return documents.length;
  },
});

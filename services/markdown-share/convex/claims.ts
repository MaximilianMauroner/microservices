import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { ensureCapabilityClaim } from "./capabilities";
import { LEGACY_TOKEN_PATTERN } from "./constants";

export const backfill = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const documents = await ctx.db.query("documents").take(500);
    for (const document of documents) {
      if (LEGACY_TOKEN_PATTERN.test(document.token)) {
        await ensureCapabilityClaim(ctx, document.token, document.createdAt);
      }
    }
    return documents.length;
  },
});

export const removeObsoleteServerClaims = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const claims = await ctx.db.query("capabilityClaims").take(500);
    const obsolete = claims.filter((claim) => claim.token === undefined);
    for (const claim of obsolete) {
      await ctx.db.delete("capabilityClaims", claim._id);
    }
    return obsolete.length;
  },
});

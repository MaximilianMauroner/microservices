import { components } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { findDocument } from "./documentAccess";
import { presence } from "./presence";
import { ensureCapabilityClaim } from "./capabilities";
import { LEGACY_TOKEN_PATTERN, MAX_CHECKPOINTS } from "./constants";

export const expire = internalMutation({
  args: { token: v.string(), expectedExpiresAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const document = await findDocument(ctx, args.token);

    if (
      !document ||
      document.expiresAt !== args.expectedExpiresAt ||
      document.expiresAt > Date.now()
    ) {
      return null;
    }

    if (LEGACY_TOKEN_PATTERN.test(args.token)) {
      await ensureCapabilityClaim(ctx, args.token, document.createdAt);
    }
    const checkpoints = await ctx.db
      .query("checkpoints")
      .withIndex("by_document_and_created_at", (index) =>
        index.eq("documentId", document._id),
      )
      .take(MAX_CHECKPOINTS);
    await Promise.all(
      checkpoints.flatMap((checkpoint) => [
        ctx.db.delete("checkpointContents", checkpoint.contentId),
        ctx.db.delete("checkpoints", checkpoint._id),
      ]),
    );
    await ctx.runMutation(components.prosemirrorSync.lib.deleteDocument, {
      id: args.token,
    });
    await presence.removeRoom(ctx, args.token);
    await ctx.db.delete("documents", document._id);
    return null;
  },
});

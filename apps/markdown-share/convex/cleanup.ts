import { components } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { findDocument } from "./documentAccess";
import { presence } from "./presence";
import { ensureCapabilityClaim } from "./capabilities";

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

    await ensureCapabilityClaim(ctx, args.token, document.createdAt);
    await ctx.runMutation(components.prosemirrorSync.lib.deleteDocument, {
      id: args.token,
    });
    await presence.removeRoom(ctx, args.token);
    await ctx.db.delete(document._id);
    return null;
  },
});

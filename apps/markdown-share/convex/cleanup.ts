import { components, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { RegisteredMutation } from "convex/server";
import { v } from "convex/values";
import { findDocument } from "./documentAccess";
import { presence } from "./presence";
import { ensureCapabilityClaim } from "./capabilities";
import { LEGACY_TOKEN_PATTERN, MAX_CHECKPOINTS } from "./constants";

type ExpireArgs = { token: string; expectedExpiresAt?: number };

async function deleteDocumentCascade(
  ctx: MutationCtx,
  document: Doc<"documents">,
): Promise<void> {
  if (LEGACY_TOKEN_PATTERN.test(document.token)) {
    await ensureCapabilityClaim(ctx, document.token, document.createdAt);
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
    id: document.token,
  });
  await presence.removeRoom(ctx, document.token);
  await ctx.db.delete("documents", document._id);
}

export const expire: RegisteredMutation<
  "internal",
  ExpireArgs,
  Promise<null>
> = internalMutation({
  args: {
    token: v.string(),
    // Compatibility for jobs scheduled by the previous alpha deployment.
    expectedExpiresAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const document = await findDocument(ctx, args.token);
    if (!document) {
      return null;
    }

    if (document.expiresAt > Date.now()) {
      await ctx.scheduler.runAt(
        document.expiresAt,
        internal.cleanup.expire,
        { token: document.token },
      );
      return null;
    }

    await deleteDocumentCascade(ctx, document);
    return null;
  },
});

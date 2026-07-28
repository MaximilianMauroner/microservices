import { components, internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { RETENTION_MS } from "./constants";
import { requireLiveDocument } from "./documentAccess";

const clientIdValidator = v.union(v.string(), v.number());
const snapshotValidator = v.union(
  v.object({ content: v.null() }),
  v.object({ content: v.string(), version: v.number() }),
);
const stepsValidator = v.object({
  steps: v.array(v.string()),
  clientIds: v.array(clientIdValidator),
  version: v.number(),
});
const submitStepsValidator = v.union(
  v.object({
    status: v.literal("needs-rebase"),
    clientIds: v.array(clientIdValidator),
    steps: v.array(v.string()),
  }),
  v.object({ status: v.literal("synced") }),
);

export const getSnapshot = query({
  args: { id: v.string(), version: v.optional(v.number()) },
  returns: snapshotValidator,
  handler: async (ctx, args) => {
    await requireLiveDocument(ctx, args.id);
    return await ctx.runQuery(components.prosemirrorSync.lib.getSnapshot, args);
  },
});

export const latestVersion = query({
  args: { id: v.string() },
  returns: v.union(v.null(), v.number()),
  handler: async (ctx, args) => {
    await requireLiveDocument(ctx, args.id);
    return await ctx.runQuery(
      components.prosemirrorSync.lib.latestVersion,
      args,
    );
  },
});

export const getSteps = query({
  args: { id: v.string(), version: v.number() },
  returns: stepsValidator,
  handler: async (ctx, args) => {
    await requireLiveDocument(ctx, args.id);
    return await ctx.runQuery(components.prosemirrorSync.lib.getSteps, args);
  },
});

export const submitSnapshot = mutation({
  args: { id: v.string(), version: v.number(), content: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireLiveDocument(ctx, args.id);
    await ctx.runMutation(components.prosemirrorSync.lib.submitSnapshot, {
      ...args,
      pruneSnapshots: true,
    });
    return null;
  },
});

export const submitSteps = mutation({
  args: {
    id: v.string(),
    version: v.number(),
    clientId: clientIdValidator,
    steps: v.array(v.string()),
  },
  returns: submitStepsValidator,
  handler: async (ctx, args) => {
    const document = await requireLiveDocument(ctx, args.id);
    const result = await ctx.runMutation(
      components.prosemirrorSync.lib.submitSteps,
      args,
    );

    if (result.status === "synced" && args.steps.length > 0) {
      const now = Date.now();
      const expiresAt = now + RETENTION_MS;

      if (document.cleanupJobId) {
        await ctx.scheduler.cancel(document.cleanupJobId);
      }
      const cleanupJobId = await ctx.scheduler.runAt(
        expiresAt,
        internal.cleanup.expire,
        { token: args.id, expectedExpiresAt: expiresAt },
      );
      await ctx.db.patch(document._id, {
        updatedAt: now,
        expiresAt,
        cleanupJobId,
      });
    }

    return result;
  },
});

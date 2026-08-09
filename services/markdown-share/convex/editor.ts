import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  renewDocumentRetention,
  requireLiveDocument,
} from "./documentLifecycle";
import {
  parseSnapshot,
  validateSubmittedSnapshot,
  validateSubmittedSteps,
} from "./protocol";

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
    const snapshot = await ctx.runQuery(
      components.prosemirrorSync.lib.getSnapshot,
      args,
    );
    if (snapshot.content !== null) {
      parseSnapshot(snapshot.content);
    }
    return snapshot;
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
    await validateSubmittedSnapshot(
      ctx,
      args.id,
      args.version,
      args.content,
    );
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
    await validateSubmittedSteps(ctx, args.id, args.version, args.steps);
    const result = await ctx.runMutation(
      components.prosemirrorSync.lib.submitSteps,
      args,
    );

    if (result.status === "synced" && args.steps.length > 0) {
      await renewDocumentRetention(ctx, document);
    }

    return result;
  },
});

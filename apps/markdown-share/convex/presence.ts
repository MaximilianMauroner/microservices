import { Presence } from "@convex-dev/presence";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { requireLiveDocument } from "./documentAccess";

export const presence = new Presence(components.presence);

const presenceStateValidator = v.object({
  userId: v.string(),
  online: v.boolean(),
  lastDisconnected: v.number(),
  name: v.optional(v.string()),
});

function displayNameFromData(data: unknown): string | undefined {
  if (
    typeof data === "object" &&
    data !== null &&
    "name" in data &&
    typeof data.name === "string"
  ) {
    return data.name;
  }
  return undefined;
}

export const heartbeat = mutation({
  args: {
    roomId: v.string(),
    userId: v.string(),
    sessionId: v.string(),
    interval: v.number(),
  },
  returns: v.object({ roomToken: v.string(), sessionToken: v.string() }),
  handler: async (ctx, args) => {
    await requireLiveDocument(ctx, args.roomId);
    return await presence.heartbeat(
      ctx,
      args.roomId,
      args.userId,
      args.sessionId,
      args.interval,
    );
  },
});

export const list = query({
  args: { roomToken: v.string() },
  returns: v.array(presenceStateValidator),
  handler: async (ctx, args) => {
    const state = await presence.list(ctx, args.roomToken);
    return state.map(({ userId, online, lastDisconnected, data }) => ({
      userId,
      online,
      lastDisconnected,
      name: displayNameFromData(data),
    }));
  },
});

export const setDisplayName = mutation({
  args: { roomId: v.string(), userId: v.string(), name: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireLiveDocument(ctx, args.roomId);
    const name = args.name.trim();
    if (name.length === 0 || name.length > 48) {
      throw new ConvexError({
        code: "INVALID_DISPLAY_NAME",
        message: "Display name must contain 1 to 48 characters.",
      });
    }
    await presence.updateRoomUser(ctx, args.roomId, args.userId, { name });
    return null;
  },
});

export const disconnect = mutation({
  args: { sessionToken: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await presence.disconnect(ctx, args.sessionToken);
    return null;
  },
});

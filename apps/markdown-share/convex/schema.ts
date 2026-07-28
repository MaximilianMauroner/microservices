import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  documents: defineTable({
    token: v.string(),
    filename: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
    cleanupJobId: v.optional(v.id("_scheduled_functions")),
  })
    .index("by_token", ["token"])
    .index("by_expires_at", ["expiresAt"]),
  capabilityClaims: defineTable({
    token: v.optional(v.string()),
    claimedAt: v.number(),
  }).index("by_token", ["token"]),
});

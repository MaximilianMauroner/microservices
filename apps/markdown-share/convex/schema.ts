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
    kind: v.optional(v.literal("legacy")),
    claimedAt: v.number(),
  }).index("by_token", ["token"]),
  capabilitySeeds: defineTable({
    createdAt: v.number(),
  }),
  checkpoints: defineTable({
    documentId: v.id("documents"),
    contentId: v.id("checkpointContents"),
    createdAt: v.number(),
    createdBy: v.string(),
    charCount: v.number(),
  }).index("by_document_and_created_at", ["documentId", "createdAt"]),
  checkpointContents: defineTable({
    markdown: v.string(),
  }),
});

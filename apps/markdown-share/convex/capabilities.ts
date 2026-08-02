import type { MutationCtx } from "./_generated/server";

export async function createServerCapability(
  ctx: Pick<MutationCtx, "db">,
  claimedAt: number,
): Promise<string> {
  // Convex generates a fresh high-entropy ID. The seed row is deleted in this
  // transaction: server IDs cannot be caller-selected or reused, so unlike
  // legacy caller tokens they need no permanent tombstone.
  const seedId = await ctx.db.insert("capabilitySeeds", {
    createdAt: claimedAt,
  });
  await ctx.db.delete("capabilitySeeds", seedId);
  return seedId;
}

export async function ensureCapabilityClaim(
  ctx: Pick<MutationCtx, "db">,
  token: string,
  claimedAt: number,
): Promise<void> {
  const claimId = ctx.db.normalizeId("capabilityClaims", token);
  if (claimId && (await ctx.db.get("capabilityClaims", claimId))) {
    return;
  }
  const existing = await ctx.db
    .query("capabilityClaims")
    .withIndex("by_token", (query) => query.eq("token", token))
    .unique();
  if (existing) {
    if (existing.kind !== "legacy") {
      await ctx.db.patch("capabilityClaims", existing._id, { kind: "legacy" });
    }
    return;
  }
  await ctx.db.insert("capabilityClaims", {
    token,
    kind: "legacy",
    claimedAt,
  });
}

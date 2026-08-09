import { internalMutation } from "./_generated/server";
import type { RegisteredMutation } from "convex/server";
import { v } from "convex/values";
import { expireDocument } from "./documentLifecycle";

type ExpireArgs = { token: string; expectedExpiresAt?: number };

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
    await expireDocument(ctx, args.token);
    return null;
  },
});

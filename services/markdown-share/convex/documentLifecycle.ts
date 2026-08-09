import { ProsemirrorSync } from "@convex-dev/prosemirror-sync";
import { Presence } from "@convex-dev/presence";
import { ConvexError } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  createServerCapability,
  ensureCapabilityClaim,
} from "./capabilities";
import { LEGACY_TOKEN_PATTERN, MAX_CHECKPOINTS, RETENTION_MS } from "./constants";

type ReadContext = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;
const prosemirrorSync = new ProsemirrorSync(components.prosemirrorSync);
const presence = new Presence(components.presence);

export async function findDocument(
  ctx: ReadContext,
  token: string,
): Promise<Doc<"documents"> | null> {
  return await ctx.db
    .query("documents")
    .withIndex("by_token", (query) => query.eq("token", token))
    .unique();
}

export async function requireLiveDocument(
  ctx: ReadContext,
  token: string,
): Promise<Doc<"documents">> {
  const document = await findDocument(ctx, token);
  if (!document) {
    throw new ConvexError({
      code: "DOCUMENT_UNAVAILABLE",
      message: "This document does not exist or has expired.",
    });
  }
  return document;
}

/** Creates the document aggregate and schedules its first retention transition. */
export async function createDocument(
  ctx: MutationCtx,
  args: { filename: string; markdown: string },
): Promise<
  Pick<
    Doc<"documents">,
    "token" | "filename" | "createdAt" | "updatedAt" | "expiresAt"
  >
> {
  const now = Date.now();
  const token = await createServerCapability(ctx, now);
  const expiresAt = now + RETENTION_MS;
  await ctx.db.insert("documents", {
    token,
    filename: args.filename,
    createdAt: now,
    updatedAt: now,
    expiresAt,
  });
  await prosemirrorSync.create(ctx, token, {
    type: "doc",
    content: [
      {
        type: "codeBlock",
        content:
          args.markdown.length > 0
            ? [{ type: "text", text: args.markdown }]
            : undefined,
      },
    ],
  });
  await ctx.scheduler.runAt(expiresAt, internal.cleanup.expire, { token });

  return {
    token,
    filename: args.filename,
    createdAt: now,
    updatedAt: now,
    expiresAt,
  };
}

/** Renews retention only after a non-empty editor change is accepted. */
export async function renewDocumentRetention(
  ctx: MutationCtx,
  document: Doc<"documents">,
): Promise<void> {
  const now = Date.now();
  await ctx.db.patch("documents", document._id, {
    updatedAt: now,
    expiresAt: now + RETENTION_MS,
  });
}

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

/** Applies the scheduled expiry transition or reschedules a renewed document. */
export async function expireDocument(
  ctx: MutationCtx,
  token: string,
): Promise<void> {
  const document = await findDocument(ctx, token);
  if (!document) {
    return;
  }
  if (document.expiresAt > Date.now()) {
    await ctx.scheduler.runAt(document.expiresAt, internal.cleanup.expire, {
      token: document.token,
    });
    return;
  }
  await deleteDocumentCascade(ctx, document);
}

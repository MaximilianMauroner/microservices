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
import {
  LEGACY_TOKEN_PATTERN,
  MAX_CHECKPOINTS,
  PINNED_RETENTION_MS,
  RETENTION_MS,
} from "./constants";

type ReadContext = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;

/** Retention window for a document, longer while it is pinned. */
export function retentionFor(pinned: boolean | undefined): number {
  return pinned ? PINNED_RETENTION_MS : RETENTION_MS;
}
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
  args: { filename: string; markdown: string; format: "markdown" | "latex" },
): Promise<
  Pick<
    Doc<"documents">,
    "token" | "filename" | "format" | "createdAt" | "updatedAt" | "expiresAt"
  >
> {
  const now = Date.now();
  const token = await createServerCapability(ctx, now);
  const expiresAt = now + RETENTION_MS;
  const documentId = await ctx.db.insert("documents", {
    token,
    filename: args.filename,
    format: args.format,
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
  await scheduleDocumentExpiry(ctx, { _id: documentId, token, expiresAt });

  return {
    token,
    filename: args.filename,
    format: args.format,
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
  const expiresAt = now + retentionFor(document.pinned);
  await ctx.db.patch("documents", document._id, {
    updatedAt: now,
    expiresAt,
  });
  await scheduleDocumentExpiry(ctx, { ...document, expiresAt });
}

export async function setDocumentPinned(
  ctx: MutationCtx,
  document: Doc<"documents">,
  pinned: boolean,
): Promise<Doc<"documents">> {
  const expiresAt = pinned
    ? document.updatedAt + PINNED_RETENTION_MS
    : document.expiresAt;
  await ctx.db.patch("documents", document._id, { pinned, expiresAt });
  const cleanupJobId = await scheduleDocumentExpiry(ctx, { ...document, expiresAt });
  return { ...document, pinned, expiresAt, cleanupJobId };
}

async function scheduleDocumentExpiry(
  ctx: MutationCtx,
  document: Pick<Doc<"documents">, "_id" | "token" | "expiresAt" | "cleanupJobId">,
) {
  const job = document.cleanupJobId
    ? await ctx.db.system.get(document.cleanupJobId)
    : null;
  if (job?.state.kind === "pending") {
    if (job.scheduledTime === document.expiresAt) {
      return job._id;
    }
    // A scheduled mutation can still read its own state as pending.
    if (job.scheduledTime > Date.now()) {
      await ctx.scheduler.cancel(job._id);
    }
  }
  const cleanupJobId = await ctx.scheduler.runAt(
    document.expiresAt,
    internal.cleanup.expire,
    { token: document.token },
  );
  await ctx.db.patch("documents", document._id, { cleanupJobId });
  return cleanupJobId;
}

async function deleteDocumentCascade(
  ctx: MutationCtx,
  document: Doc<"documents">,
): Promise<void> {
  if (document.cleanupJobId) {
    const job = await ctx.db.system.get(document.cleanupJobId);
    if (job?.state.kind === "pending" && job.scheduledTime > Date.now()) {
      await ctx.scheduler.cancel(job._id);
    }
  }
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
    await scheduleDocumentExpiry(ctx, document);
    return;
  }
  await deleteDocumentCascade(ctx, document);
}

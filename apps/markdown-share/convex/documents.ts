import { ProsemirrorSync } from "@convex-dev/prosemirror-sync";
import { ConvexError, v } from "convex/values";
import { internal, components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import {
  FILENAME_PATTERN,
  LEGACY_TOKEN_PATTERN,
  MAX_FILENAME_LENGTH,
  MAX_MARKDOWN_LENGTH,
  RETENTION_MS,
} from "./constants";
import { findDocument, findLiveDocument } from "./documentAccess";
import {
  claimLegacyCapability,
  createServerCapability,
} from "./capabilities";

const prosemirrorSync = new ProsemirrorSync(components.prosemirrorSync);

const publicDocument = v.object({
  token: v.string(),
  filename: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  expiresAt: v.number(),
});

function validateCreateInput(filename: string, markdown: string) {
  if (
    filename.length > MAX_FILENAME_LENGTH ||
    !FILENAME_PATTERN.test(filename)
  ) {
    throw new ConvexError({
      code: "INVALID_FILENAME",
      message: "Use a short URL-safe filename ending in .md.",
    });
  }
  if (markdown.length > MAX_MARKDOWN_LENGTH) {
    throw new ConvexError({
      code: "DOCUMENT_TOO_LARGE",
      message: "Markdown documents are limited to 500,000 characters.",
    });
  }
}

function toPublicDocument(document: {
  token: string;
  filename: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}) {
  return {
    token: document.token,
    filename: document.filename,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    expiresAt: document.expiresAt,
  };
}

export const create = mutation({
  args: {
    filename: v.string(),
    // Temporary compatibility for the already-deployed alpha bundle. New
    // clients omit this and receive a server-generated capability.
    token: v.optional(v.string()),
    markdown: v.string(),
  },
  returns: publicDocument,
  handler: async (ctx, args) => {
    validateCreateInput(args.filename, args.markdown);

    const now = Date.now();
    let token: string;
    if (args.token !== undefined) {
      if (!LEGACY_TOKEN_PATTERN.test(args.token)) {
        throw new ConvexError({
          code: "INVALID_TOKEN",
          message: "The legacy document link token is invalid.",
        });
      }
      if (await findDocument(ctx, args.token)) {
        throw new ConvexError({
          code: "TOKEN_ALREADY_USED",
          message: "This document capability has already been used.",
        });
      }
      await claimLegacyCapability(ctx, args.token, now);
      token = args.token;
    } else {
      token = await createServerCapability(ctx, now);
    }
    const expiresAt = now + RETENTION_MS;
    const documentId = await ctx.db.insert("documents", {
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

    const cleanupJobId = await ctx.scheduler.runAt(
      expiresAt,
      internal.cleanup.expire,
      { token, expectedExpiresAt: expiresAt },
    );
    await ctx.db.patch("documents", documentId, { cleanupJobId });

    return toPublicDocument({
      token,
      filename: args.filename,
      createdAt: now,
      updatedAt: now,
      expiresAt,
    });
  },
});

export const get = query({
  args: { token: v.string() },
  returns: v.union(publicDocument, v.null()),
  handler: async (ctx, args) => {
    const document = await findLiveDocument(ctx, args.token);
    if (!document) {
      return null;
    }
    return toPublicDocument(document);
  },
});

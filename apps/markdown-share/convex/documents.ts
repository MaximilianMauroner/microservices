import { ProsemirrorSync } from "@convex-dev/prosemirror-sync";
import { ConvexError, v } from "convex/values";
import { internal, components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import {
  FILENAME_PATTERN,
  MAX_FILENAME_LENGTH,
  MAX_MARKDOWN_LENGTH,
  RETENTION_MS,
  TOKEN_PATTERN,
} from "./constants";
import { findDocument } from "./documentAccess";

const prosemirrorSync = new ProsemirrorSync(components.prosemirrorSync);

const publicDocument = v.object({
  token: v.string(),
  filename: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  expiresAt: v.number(),
});

function validateCreateInput(filename: string, token: string, markdown: string) {
  if (
    filename.length > MAX_FILENAME_LENGTH ||
    !FILENAME_PATTERN.test(filename)
  ) {
    throw new ConvexError({
      code: "INVALID_FILENAME",
      message: "Use a short URL-safe filename ending in .md.",
    });
  }
  if (!TOKEN_PATTERN.test(token)) {
    throw new ConvexError({
      code: "INVALID_TOKEN",
      message: "The document link token is invalid.",
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
    token: v.string(),
    markdown: v.string(),
  },
  returns: publicDocument,
  handler: async (ctx, args) => {
    validateCreateInput(args.filename, args.token, args.markdown);

    if (await findDocument(ctx, args.token)) {
      throw new ConvexError({
        code: "TOKEN_COLLISION",
        message: "Please create the document again to generate a new link.",
      });
    }

    const now = Date.now();
    const expiresAt = now + RETENTION_MS;
    const documentId = await ctx.db.insert("documents", {
      token: args.token,
      filename: args.filename,
      createdAt: now,
      updatedAt: now,
      expiresAt,
    });

    await prosemirrorSync.create(ctx, args.token, {
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
      { token: args.token, expectedExpiresAt: expiresAt },
    );
    await ctx.db.patch(documentId, { cleanupJobId });

    return toPublicDocument({
      token: args.token,
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
    if (!TOKEN_PATTERN.test(args.token)) {
      return null;
    }

    const document = await findDocument(ctx, args.token);
    if (!document || document.expiresAt <= Date.now()) {
      return null;
    }
    return toPublicDocument(document);
  },
});

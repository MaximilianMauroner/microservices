import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  FILENAME_PATTERN,
  MAX_FILENAME_LENGTH,
  MAX_MARKDOWN_LENGTH,
} from "./constants";
import {
  createDocument,
  findDocument,
  requireLiveDocument,
  setDocumentPinned,
} from "./documentLifecycle";

const publicDocument = v.object({
  token: v.string(),
  filename: v.string(),
  format: v.union(v.literal("markdown"), v.literal("latex")),
  createdAt: v.number(),
  updatedAt: v.number(),
  expiresAt: v.number(),
  pinned: v.boolean(),
});

function validateCreateInput(filename: string, markdown: string, format: "markdown" | "latex") {
  if (
    filename.length > MAX_FILENAME_LENGTH ||
    !FILENAME_PATTERN.test(filename) ||
    !filename.endsWith(format === "latex" ? ".tex" : ".md")
  ) {
    throw new ConvexError({
      code: "INVALID_FILENAME",
      message: "Use a short URL-safe filename matching the document format.",
    });
  }
  if (markdown.length > MAX_MARKDOWN_LENGTH) {
    throw new ConvexError({
      code: "DOCUMENT_TOO_LARGE",
      message: "Documents are limited to 500,000 characters.",
    });
  }
}

function toPublicDocument(document: {
  token: string;
  filename: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  pinned?: boolean;
  format?: "markdown" | "latex";
}) {
  return {
    token: document.token,
    filename: document.filename,
    format: document.format ?? "markdown",
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    expiresAt: document.expiresAt,
    pinned: document.pinned ?? false,
  };
}

export const create = mutation({
  args: {
    filename: v.string(),
    format: v.optional(v.union(v.literal("markdown"), v.literal("latex"))),
    markdown: v.string(),
  },
  returns: publicDocument,
  handler: async (ctx, args) => {
    const format = args.format ?? "markdown";
    validateCreateInput(args.filename, args.markdown, format);

    const document = await createDocument(ctx, {
      filename: args.filename,
      format,
      markdown: args.markdown,
    });
    return toPublicDocument(document);
  },
});

export const setPinned = mutation({
  args: { token: v.string(), pinned: v.boolean() },
  returns: publicDocument,
  handler: async (ctx, args) => {
    const document = await requireLiveDocument(ctx, args.token);
    const updated = await setDocumentPinned(ctx, document, args.pinned);
    return toPublicDocument(updated);
  },
});

export const get = query({
  args: { token: v.string() },
  returns: v.union(publicDocument, v.null()),
  handler: async (ctx, args) => {
    const document = await findDocument(ctx, args.token);
    if (!document) {
      return null;
    }
    return toPublicDocument(document);
  },
});

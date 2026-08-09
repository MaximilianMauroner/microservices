import type { MutationCtx } from "./_generated/server";
import { components } from "./_generated/api";
import { ConvexError } from "convex/values";
import { Node, Schema } from "prosemirror-model";
import { Step, Transform } from "prosemirror-transform";
import { MAX_MARKDOWN_LENGTH } from "./constants";

const markdownSchema = new Schema({
  nodes: {
    doc: { content: "codeBlock" },
    codeBlock: {
      attrs: { language: { default: null } },
      content: "text*",
      group: "block",
      marks: "",
      code: true,
      defining: true,
    },
    text: { group: "inline" },
  },
});

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: JsonRecord, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function invalidProtocol(message: string) {
  return new ConvexError({ code: "INVALID_EDITOR_PAYLOAD", message });
}

function parseJson(serialized: string, label: string): unknown {
  try {
    const parsed: unknown = JSON.parse(serialized);
    return parsed;
  } catch {
    throw invalidProtocol(`${label} is not valid JSON.`);
  }
}

export function parseSnapshot(serialized: string): {
  node: Node;
  markdown: string;
} {
  const parsed = parseJson(serialized, "Snapshot");
  if (
    !isRecord(parsed) ||
    !hasOnlyKeys(parsed, ["type", "content"]) ||
    parsed.type !== "doc" ||
    !Array.isArray(parsed.content) ||
    parsed.content.length !== 1
  ) {
    throw invalidProtocol("Snapshot must contain exactly one code block.");
  }

  const codeBlock = parsed.content[0];
  if (
    !isRecord(codeBlock) ||
    !hasOnlyKeys(codeBlock, ["type", "attrs", "content"]) ||
    codeBlock.type !== "codeBlock"
  ) {
    throw invalidProtocol("Snapshot must contain exactly one code block.");
  }
  if (codeBlock.attrs !== undefined) {
    if (
      !isRecord(codeBlock.attrs) ||
      !hasOnlyKeys(codeBlock.attrs, ["language"]) ||
      codeBlock.attrs.language !== null
    ) {
      throw invalidProtocol("Code block attributes are not supported.");
    }
  }

  let markdown = "";
  if (codeBlock.content !== undefined) {
    if (!Array.isArray(codeBlock.content) || codeBlock.content.length !== 1) {
      throw invalidProtocol("Code block content must be a single text node.");
    }
    const text = codeBlock.content[0];
    if (
      !isRecord(text) ||
      !hasOnlyKeys(text, ["type", "text"]) ||
      text.type !== "text" ||
      typeof text.text !== "string" ||
      text.text.length === 0
    ) {
      throw invalidProtocol("Code block content must be a single text node.");
    }
    markdown = text.text;
  }

  assertMarkdownSize(markdown);
  const codeNode = markdownSchema.node(
    "codeBlock",
    { language: null },
    markdown ? markdownSchema.text(markdown) : undefined,
  );
  return {
    node: markdownSchema.node("doc", undefined, codeNode),
    markdown,
  };
}

function assertMarkdownSize(markdown: string): void {
  if (markdown.length > MAX_MARKDOWN_LENGTH) {
    throw new ConvexError({
      code: "DOCUMENT_TOO_LARGE",
      message: "Markdown documents are limited to 500,000 characters.",
    });
  }
}

function validateVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw invalidProtocol("Editor version must be a positive integer.");
  }
}

export async function documentAtVersion(
  ctx: Pick<MutationCtx, "runQuery">,
  id: string,
  targetVersion: number,
): Promise<Node> {
  validateVersion(targetVersion);
  const snapshot = await ctx.runQuery(
    components.prosemirrorSync.lib.getSnapshot,
    { id, version: targetVersion },
  );
  if (snapshot.content === null || snapshot.version > targetVersion) {
    throw invalidProtocol("Editor history is unavailable at this version.");
  }

  const initial = parseSnapshot(snapshot.content);
  const transform = new Transform(initial.node);
  let version = snapshot.version;

  while (version < targetVersion) {
    const history = await ctx.runQuery(
      components.prosemirrorSync.lib.getSteps,
      { id, version },
    );
    const remaining = targetVersion - version;
    const serializedSteps = history.steps.slice(0, remaining);
    if (serializedSteps.length === 0) {
      throw invalidProtocol("Editor history is incomplete at this version.");
    }
    for (const serialized of serializedSteps) {
      const parsed = parseJson(serialized, "Stored step");
      if (!isRecord(parsed)) {
        throw invalidProtocol("Stored step has an invalid shape.");
      }
      try {
        transform.step(Step.fromJSON(markdownSchema, parsed));
      } catch {
        throw invalidProtocol("Stored editor history is invalid.");
      }
    }
    version += serializedSteps.length;
  }

  const canonical = parseSnapshot(JSON.stringify(transform.doc.toJSON()));
  return canonical.node;
}

export async function markdownAtVersion(
  ctx: Pick<MutationCtx, "runQuery">,
  id: string,
  targetVersion: number,
): Promise<string> {
  const document = await documentAtVersion(ctx, id, targetVersion);
  return parseSnapshot(JSON.stringify(document.toJSON())).markdown;
}

export async function validateSubmittedSteps(
  ctx: Pick<MutationCtx, "runQuery">,
  id: string,
  version: number,
  serializedSteps: string[],
): Promise<void> {
  if (serializedSteps.length === 0 || serializedSteps.length > 1_000) {
    throw invalidProtocol("Submit between 1 and 1,000 editor steps.");
  }

  const base = await documentAtVersion(ctx, id, version);
  const transform = new Transform(base);
  for (const serialized of serializedSteps) {
    const parsed = parseJson(serialized, "Step");
    if (!isRecord(parsed)) {
      throw invalidProtocol("Editor step has an invalid shape.");
    }
    try {
      transform.step(Step.fromJSON(markdownSchema, parsed));
    } catch {
      throw invalidProtocol("Editor step cannot be applied to this document.");
    }
  }
  // Steps such as AttrStep can apply successfully while changing the document
  // to a schema shape the Markdown client does not support. Re-validate the
  // complete result with the exact same canonical invariant as snapshots.
  parseSnapshot(JSON.stringify(transform.doc.toJSON()));
}

export async function validateSubmittedSnapshot(
  ctx: Pick<MutationCtx, "runQuery">,
  id: string,
  version: number,
  serialized: string,
): Promise<void> {
  const submitted = parseSnapshot(serialized);
  const expected = await documentAtVersion(ctx, id, version);
  if (!submitted.node.eq(expected)) {
    throw invalidProtocol("Snapshot does not match the accepted editor history.");
  }
}

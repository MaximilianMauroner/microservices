import { Node, Schema } from "prosemirror-model";
import { Step, Transform } from "prosemirror-transform";
import { ShareError, type EditorContent } from "./types";
import { sourceSizeError } from "./source-limits";

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
  return new ShareError("INVALID_EDITOR_PAYLOAD", message);
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

  const sizeError = sourceSizeError(markdown);
  if (sizeError) throw new ShareError("DOCUMENT_TOO_LARGE", sizeError);
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

export function sourceSnapshot(markdown: string): EditorContent {
  return parseSnapshot(JSON.stringify({ type: "doc", content: [{ type: "codeBlock", ...(markdown ? { content: [{ type: "text", text: markdown }] } : {}) }] })).node.toJSON();
}

export function applySteps(content: EditorContent, steps: unknown[]): { content: EditorContent; markdown: string } {
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 1000) throw invalidProtocol("Submit between 1 and 1,000 editor steps.");
  const transform = new Transform(parseSnapshot(JSON.stringify(content)).node);
  for (const step of steps) {
    try {
      if (!isRecord(step)) throw new Error();
      transform.step(Step.fromJSON(markdownSchema, step));
    } catch {
      throw invalidProtocol("Editor step cannot be applied to this document.");
    }
  }
  const result = parseSnapshot(JSON.stringify(transform.doc.toJSON()));
  return { content: result.node.toJSON(), markdown: result.markdown };
}

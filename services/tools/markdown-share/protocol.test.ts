import { describe, expect, it } from "vitest";
import { applySteps, parseSnapshot, sourceSnapshot } from "./protocol";

describe("plain source protocol", () => {
  it("accepts plain source replacements and empty source", () => {
    expect(applySteps(sourceSnapshot("abc"), [{ stepType: "replace", from: 1, to: 4 }]).markdown).toBe("");
    expect(parseSnapshot(JSON.stringify(sourceSnapshot("A\n😀"))).markdown).toBe("A\n😀");
  });
  it("rejects rich structure, marks, attributes, invalid steps, and both size limits", () => {
    for (const content of [
      { type: "doc", content: [] },
      { type: "doc", content: [{ type: "paragraph" }] },
      { type: "doc", content: [{ type: "codeBlock", attrs: { language: "js" } }] },
      { type: "doc", content: [{ type: "codeBlock", content: [{ type: "text", text: "a", marks: [] }] }] },
    ]) expect(() => parseSnapshot(JSON.stringify(content))).toThrowError(expect.objectContaining({ data: expect.objectContaining({ code: "INVALID_EDITOR_PAYLOAD" }) }));
    expect(() => applySteps(sourceSnapshot("a"), [{ stepType: "attr", pos: 0, attr: "language", value: "js" }])).toThrow();
    expect(() => applySteps(sourceSnapshot("a"), [{ stepType: "replace", from: 99, to: 99 }])).toThrow();
    for (const source of ["a".repeat(500001), '"'.repeat(300000), "😀".repeat(230000)]) {
      expect(() => sourceSnapshot(source)).toThrowError(expect.objectContaining({ data: expect.objectContaining({ code: "DOCUMENT_TOO_LARGE" }) }));
    }
  });
});

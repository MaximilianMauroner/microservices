import { describe, expect, it } from "vitest";
import { DEFAULT_FEEDBACK_INTRODUCTION, DEFAULT_GERMAN_TRANSLATION, FEEDBACK_TEMPLATE } from "../feedback/domain.js";
import { feedbackSchemaJson, feedbackSchemaPrompt, parseFeedbackSchemaJson } from "../feedback/schema-exchange.js";

const content = { title: "Post-hangout feedback", introduction: DEFAULT_FEEDBACK_INTRODUCTION, questions: FEEDBACK_TEMPLATE, german: DEFAULT_GERMAN_TRANSLATION };

describe("feedback schema exchange", () => {
  it("copies a versioned form and response schema that can be pasted back", () => {
    const json = feedbackSchemaJson(content);
    expect(JSON.parse(json).responseSchema.properties.comfort.enum).toEqual(FEEDBACK_TEMPLATE[0].options);
    expect(parseFeedbackSchemaJson(json)).toEqual(content);
  });

  it("rejects invalid or structurally changed schemas", () => {
    expect(() => parseFeedbackSchemaJson("not json")).toThrow("not valid JSON");
    const changed = JSON.parse(feedbackSchemaJson(content));
    changed.form.questions[0].id = "different-id";
    expect(() => parseFeedbackSchemaJson(JSON.stringify(changed))).toThrow("question set is invalid");
  });

  it("copies a prompt containing the response schema and preservation rules", () => {
    const prompt = feedbackSchemaPrompt(content);
    expect(prompt).toContain("Return JSON only");
    expect(prompt).toContain('"responseSchema"');
  });
});

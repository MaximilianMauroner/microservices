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

  it("rejects invalid JSON and unsafe response keys", () => {
    expect(() => parseFeedbackSchemaJson("not json")).toThrow("not valid JSON");
    const changed = JSON.parse(feedbackSchemaJson(content));
    changed.form.questions[0].id = "website";
    expect(() => parseFeedbackSchemaJson(JSON.stringify(changed))).toThrow("unique lowercase keys");
  });

  it("rejects machine keys used as visible choice labels", () => {
    const english = JSON.parse(feedbackSchemaJson(content));
    english.form.questions[0].options[0] = "very_comfortable";
    expect(() => parseFeedbackSchemaJson(JSON.stringify(english))).toThrow("readable labels");

    const german = JSON.parse(feedbackSchemaJson(content));
    german.form.german.optionLabels.comfort[0] = "very_comfortable";
    expect(() => parseFeedbackSchemaJson(JSON.stringify(german))).toThrow("readable labels");
  });

  it("allows pasted JSON to add, remove, and reorder questions", () => {
    const changed = JSON.parse(feedbackSchemaJson(content));
    changed.form.questions = [
      { id: "best_moment", kind: "short_text", prompt: "What was the best moment?" },
      changed.form.questions.find((question: { id: string }) => question.id === "comfort")
    ];
    changed.form.german.questionPrompts.best_moment = "Was war der schönste Moment?";
    const parsed = parseFeedbackSchemaJson(JSON.stringify(changed));
    expect(parsed.questions.map((question) => question.id)).toEqual(["best_moment", "comfort"]);
    expect(parsed.questions.some((question) => question.id === "identity")).toBe(false);
  });

  it("copies a prompt containing the response schema and preservation rules", () => {
    const prompt = feedbackSchemaPrompt(content);
    expect(prompt).toContain("Return JSON only");
    expect(prompt).toContain('"responseSchema"');
    expect(prompt).toContain("You may add, remove, or reorder questions");
    expect(prompt).toContain("choice: id, kind, prompt, and 2 to 12 unique options");
    expect(prompt).toContain("natural German display labels");
  });
});

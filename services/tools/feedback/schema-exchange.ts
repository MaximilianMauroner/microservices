import {
  assertFeedbackText,
  validateFeedbackQuestions,
  validateFeedbackTranslation,
  type FeedbackQuestion,
  type FeedbackTranslation
} from "./domain.js";

export type FeedbackEditableContent = Readonly<{
  title: string;
  introduction: string;
  questions: readonly FeedbackQuestion[];
  german: FeedbackTranslation;
}>;

export function feedbackSchemaJson(content: FeedbackEditableContent) {
  return JSON.stringify({
    version: 1,
    capabilities: {
      questionKinds: {
        choice: { fields: ["id", "kind", "prompt", "options"], optionCount: { minimum: 2, maximum: 12 } },
        short_text: { fields: ["id", "kind", "prompt"], responseMaxLength: 300 },
        long_text: { fields: ["id", "kind", "prompt"], responseMaxLength: 4_000 }
      },
      questionCount: { minimum: 1, maximum: 20 },
      questionId: { pattern: "^[a-z][a-z0-9_]{0,63}$", reserved: ["website"] },
      optionalQuestions: true,
      reorderByArrayPosition: true,
      translations: ["en", "de"]
    },
    form: content,
    responseSchema: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(content.questions.map((question) => [question.id, question.kind === "choice"
        ? { type: "string", enum: question.options }
        : { type: "string", maxLength: question.kind === "long_text" ? 4_000 : 300 }]))
    }
  }, null, 2);
}

export function parseFeedbackSchemaJson(text: string): FeedbackEditableContent {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("The pasted schema is not valid JSON."); }
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.form)) throw new Error("The pasted schema must use Feedback schema version 1.");
  const form = value.form;
  if (typeof form.title !== "string" || typeof form.introduction !== "string" || !Array.isArray(form.questions) || !isRecord(form.german)) throw new Error("The pasted schema is missing form content.");
  const questions = validateFeedbackQuestions(form.questions as FeedbackQuestion[]);
  return {
    title: assertFeedbackText(form.title, "title"),
    introduction: assertFeedbackText(form.introduction, "introduction"),
    questions,
    german: validateFeedbackTranslation(form.german as FeedbackTranslation, questions)
  };
}

export function feedbackSchemaPrompt(content: FeedbackEditableContent) {
  return `Create or revise this Feedback schema. Return JSON only.

You may add, remove, or reorder questions in form.questions. Supported question kinds are:
- choice: id, kind, prompt, and 2 to 12 unique options
- short_text: id, kind, and prompt, with answers limited to 300 characters
- long_text: id, kind, and prompt, with answers limited to 4000 characters

Question ids become response property names. Use unique lowercase ids matching ^[a-z][a-z0-9_]{0,63}$ and never use website. Choice options are visible to respondents and stored as response values, so write them as concise, natural English display labels such as "Very comfortable", never identifiers such as "very_comfortable". Keep them stable after publishing. Add matching German questionPrompts and natural German display labels in optionLabels for every question. Never copy English options or snake_case identifiers into German optionLabels. The German optionLabels array must have the same length and order as its canonical options array. Update responseSchema so its properties exactly match form.questions. Every question is optional. Preserve version 1 and return the complete document without Markdown fences.

${feedbackSchemaJson(content)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

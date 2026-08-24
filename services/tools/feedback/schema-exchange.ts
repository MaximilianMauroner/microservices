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
  return `Translate or revise this feedback form schema. Preserve version, question ids, question kinds, canonical choice values, and responseSchema property names. Edit only human-readable titles, introductions, prompts, and German option labels. Return JSON only.\n\n${feedbackSchemaJson(content)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

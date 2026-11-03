import {
  assertFeedbackLanguage,
  assertFeedbackText,
  feedbackChoiceDetailsKey,
  validateFeedbackQuestions,
  type FeedbackLanguage,
  type FeedbackQuestion,
} from "./domain.js";

export type FeedbackEditableContent = Readonly<{
  language: FeedbackLanguage;
  title: string;
  introduction: string;
  questions: readonly FeedbackQuestion[];
}>;

export function feedbackSchemaJson(content: FeedbackEditableContent) {
  const responseProperties: Record<string, unknown> = {};
  for (const question of content.questions) {
    responseProperties[question.id] = question.kind === "choice"
      ? { type: "string", enum: question.options }
      : { type: "string", maxLength: question.kind === "long_text" ? 4_000 : 300 };
    if (question.kind === "choice") responseProperties[feedbackChoiceDetailsKey(question.id)] = { type: "string", maxLength: 4_000, description: "Optional explanation for the selected answer" };
  }
  return JSON.stringify({
    version: 2,
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
      languages: ["en", "de"],
      singleLanguage: true
    },
    form: content,
    responseSchema: {
      type: "object",
      additionalProperties: false,
      properties: responseProperties
    }
  }, null, 2);
}

export function parseFeedbackSchemaJson(text: string): FeedbackEditableContent {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("The pasted schema is not valid JSON."); }
  if (!isRecord(value) || (value.version !== 1 && value.version !== 2) || !isRecord(value.form)) throw new Error("The pasted schema must use Feedback schema version 1 or 2.");
  const form = value.form;
  if (typeof form.title !== "string" || typeof form.introduction !== "string" || !Array.isArray(form.questions)) throw new Error("The pasted schema is missing form content.");
  const questions = validateFeedbackQuestions(form.questions as FeedbackQuestion[]);
  return {
    language: value.version === 1 ? "en" : assertFeedbackLanguage(typeof form.language === "string" ? form.language : ""),
    title: assertFeedbackText(form.title, "title"),
    introduction: assertFeedbackText(form.introduction, "introduction"),
    questions,
  };
}

export function feedbackSchemaPrompt(content: FeedbackEditableContent) {
  return `Before you touch the JSON, ask me these six questions in one message:
1. Should this form be written in German or English?
2. What is this feedback form about? Ask for the event, product, service, interaction, or situation, plus the context you need to understand it.
3. Who will answer it?
4. What should the answers help you learn, improve, or decide?
5. Which topics must the questions cover, and are there any topics or personal details to avoid?
6. How long should the form be, and what tone should it use?

Wait for my answers. Do not return JSON early. Then write or revise the Feedback schema in the chosen language. Return only the complete JSON document, without Markdown fences. Treat the existing form below as a draft. Replace anything that does not fit my answers.

Make every question earn its place. Each one must help with a goal I named. Ask one thing at a time. Use neutral, specific wording that the intended respondents will understand on the first read. Cut leading questions, assumptions, and duplicates. Do not ask for a name or contact details unless I request it.

Put easy, broad questions first and more specific ones later. End with an open question only if it can uncover something the other questions miss. For choice questions, write distinct options in parallel language and cover the answers people are likely to give. Do not pad the list. Use short_text for concise facts. Use long_text only when a thoughtful explanation is worth the effort.

You may add, remove, or reorder questions in form.questions. Supported question kinds are:
- choice: id, kind, prompt, and 2 to 12 unique options
- short_text: id, kind, and prompt, with answers limited to 300 characters
- long_text: id, kind, and prompt, with answers limited to 4000 characters

Set form.language to en or de to match the chosen language. Write the title, introduction, prompts, and choice options only in that language. Question ids become response property names. Use unique lowercase ids matching ^[a-z][a-z0-9_]{0,63}$ and never use website. Choice options are visible to respondents and stored as response values. Each choice also has an optional details:<question_id> response property with up to 4000 characters. Write concise display labels, never identifiers such as "very_comfortable". Keep them stable after publishing. Update responseSchema so its properties match the questions and their optional choice details. Every question is optional. Preserve version 2.

${feedbackSchemaJson(content)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

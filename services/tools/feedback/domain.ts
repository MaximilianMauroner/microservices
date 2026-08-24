export const FEEDBACK_TEMPLATE = [
  { id: "comfort", kind: "choice", prompt: "How did you feel during our hangout?", options: ["Very comfortable", "Mostly comfortable", "Mixed", "Somewhat uncomfortable", "Very uncomfortable"] },
  { id: "disliked", kind: "long_text", prompt: "Was there anything I said or did that you did not like, or that made you uncomfortable?" },
  { id: "different", kind: "long_text", prompt: "Is there anything you would like me to do differently next time?" },
  { id: "enjoyed", kind: "long_text", prompt: "Was there anything you especially enjoyed or would like more of?" },
  { id: "follow_up", kind: "choice", prompt: "Do you want me to follow up with you?", options: ["No", "Yes", "Only if you think it would help"] },
  { id: "identity", kind: "short_text", prompt: "Your name or contact details" }
] as const;

export type FeedbackQuestion = Readonly<{
  id: string;
  kind: "choice" | "short_text" | "long_text";
  prompt: string;
  options?: readonly string[];
  optionLabels?: readonly string[];
}>;

export type FeedbackLocale = "en" | "de";
export type FeedbackTranslation = Readonly<{
  title: string;
  introduction: string;
  questionPrompts: Readonly<Record<string, string>>;
  optionLabels: Readonly<Record<string, readonly string[]>>;
}>;

export type FeedbackFormStatus = "draft" | "active" | "closed";
export type FeedbackReviewState = "unread" | "reviewed" | "archived";
export type FeedbackFollowUpState = "none" | "wanted" | "done";

export type FeedbackForm = Readonly<{
  id: string;
  publicToken: string;
  title: string;
  introduction: string;
  questions: readonly FeedbackQuestion[];
  translations: Readonly<Partial<Record<FeedbackLocale, FeedbackTranslation>>>;
  status: FeedbackFormStatus;
  createdAt: string;
  updatedAt: string;
  responseCount: number;
  unreadCount: number;
}>;

export type FeedbackSubmission = Readonly<{
  id: string;
  formId: string;
  formTitle: string;
  questionSnapshot: readonly FeedbackQuestion[];
  answers: Readonly<Record<string, string>>;
  submittedAt: string;
  reviewState: FeedbackReviewState;
  followUpState: FeedbackFollowUpState;
}>;

export const DEFAULT_FEEDBACK_INTRODUCTION = "Thanks for hanging out with me. I care about how people feel around me, and I know some feedback can be awkward to say in the moment. Every question is optional, and you do not need to give your name.";
export const DEFAULT_GERMAN_TRANSLATION: FeedbackTranslation = {
  title: "Feedback nach unserem Treffen",
  introduction: "Danke für unser Treffen. Mir ist wichtig, wie sich andere Menschen in meiner Nähe fühlen. Manche Rückmeldungen sind im Moment selbst schwer auszusprechen. Jede Frage ist freiwillig, und du musst deinen Namen nicht angeben.",
  questionPrompts: {
    comfort: "Wie hast du dich während unseres Treffens gefühlt?",
    disliked: "Gab es etwas, das ich gesagt oder getan habe, das dir nicht gefallen hat oder bei dem du dich unwohl gefühlt hast?",
    different: "Gibt es etwas, das ich beim nächsten Mal anders machen sollte?",
    enjoyed: "Gab es etwas, das dir besonders gefallen hat oder von dem du dir mehr wünschen würdest?",
    follow_up: "Möchtest du, dass ich mich dazu bei dir melde?",
    identity: "Dein Name oder deine Kontaktdaten"
  },
  optionLabels: {
    comfort: ["Sehr wohl", "Meistens wohl", "Gemischt", "Eher unwohl", "Sehr unwohl"],
    follow_up: ["Nein", "Ja", "Nur wenn du denkst, dass es helfen würde"]
  }
};

export function feedbackLocale(value: string | undefined): FeedbackLocale { return value === "de" ? "de" : "en"; }

export function localizeFeedbackForm(form: FeedbackForm, locale: FeedbackLocale) {
  const translation = locale === "en" ? undefined : form.translations[locale];
  return {
    ...form,
    locale,
    title: translation?.title || form.title,
    introduction: translation?.introduction || form.introduction,
    questions: form.questions.map((question) => ({
      ...question,
      prompt: translation?.questionPrompts[question.id] || question.prompt,
      optionLabels: translation?.optionLabels[question.id]
    }))
  };
}
export type LocalizedFeedbackForm = ReturnType<typeof localizeFeedbackForm>;

export function validateFeedbackAnswers(questions: readonly FeedbackQuestion[], input: Record<string, FormDataEntryValue>): Record<string, string> {
  const allowed = new Map(questions.map((question) => [question.id, question]));
  const answers: Record<string, string> = {};
  for (const [key, raw] of Object.entries(input)) {
    if (key === "website") continue;
    const question = allowed.get(key);
    if (!question || typeof raw !== "string") throw new FeedbackValidationError("invalid_answer", "The response contains an unknown answer.");
    const value = raw.trim();
    if (!value) continue;
    const maximum = question.kind === "long_text" ? 4_000 : 300;
    if (value.length > maximum) throw new FeedbackValidationError("answer_too_long", `An answer exceeds ${maximum} characters.`);
    if (question.kind === "choice" && !question.options?.includes(value)) throw new FeedbackValidationError("invalid_choice", "A selected answer is not available.");
    answers[key] = value;
  }
  if (Object.keys(answers).length === 0) throw new FeedbackValidationError("empty_submission", "Write or select at least one answer before submitting.");
  return answers;
}

export function assertFeedbackText(value: string, field: "title" | "introduction") {
  const cleaned = value.trim();
  const maximum = field === "title" ? 120 : 2_000;
  if (!cleaned || cleaned.length > maximum) throw new FeedbackValidationError(`invalid_${field}`, `${field === "title" ? "Title" : "Introduction"} must be between 1 and ${maximum} characters.`);
  return cleaned;
}

export function validateFeedbackQuestions(value: unknown): readonly FeedbackQuestion[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) throw new FeedbackValidationError("invalid_questions", "A form must have between 1 and 20 questions.");
  const seen = new Set<string>();
  return value.map((raw) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new FeedbackValidationError("invalid_questions", "Each question must be an object.");
    const question = raw as Record<string, unknown>;
    if (typeof question.id !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(question.id) || question.id === "website" || seen.has(question.id)) throw new FeedbackValidationError("invalid_questions", "Question IDs must be unique lowercase keys and cannot use website.");
    if (question.kind !== "choice" && question.kind !== "short_text" && question.kind !== "long_text") throw new FeedbackValidationError("invalid_questions", "Question kind must be choice, short_text, or long_text.");
    if (typeof question.prompt !== "string") throw new FeedbackValidationError("invalid_question_prompt", "Every question needs a prompt.");
    seen.add(question.id);
    const prompt = question.prompt.trim();
    if (!prompt || prompt.length > 300) throw new FeedbackValidationError("invalid_question_prompt", "Question prompts must be between 1 and 300 characters.");
    if (question.kind === "choice") {
      if (!Array.isArray(question.options) || question.options.length < 2 || question.options.length > 12 || question.options.some((option) => typeof option !== "string" || !option.trim() || option.length > 120)) throw new FeedbackValidationError("invalid_questions", "Choice questions need between 2 and 12 nonempty options.");
      const options = question.options.map((option) => (option as string).trim());
      if (options.some(looksLikeMachineKey)) throw new FeedbackValidationError("invalid_questions", "Choice options must be readable labels, not snake_case keys.");
      if (new Set(options).size !== options.length) throw new FeedbackValidationError("invalid_questions", "Choice options must be unique.");
      return { id: question.id, kind: question.kind, prompt, options };
    }
    return { id: question.id, kind: question.kind, prompt };
  });
}

export function validateFeedbackTranslation(value: FeedbackTranslation, questions: readonly FeedbackQuestion[]): FeedbackTranslation {
  const title = assertFeedbackText(value.title, "title");
  const introduction = assertFeedbackText(value.introduction, "introduction");
  const questionIds = new Set(questions.map((question) => question.id));
  const questionPrompts = Object.fromEntries(Object.entries(value.questionPrompts).filter(([id]) => questionIds.has(id)).map(([id, prompt]) => {
    const cleaned = prompt.trim();
    if (!cleaned || cleaned.length > 300) throw new FeedbackValidationError("invalid_translation", "Translated question prompts must be between 1 and 300 characters.");
    return [id, cleaned];
  }));
  if (questions.some((question) => !questionPrompts[question.id])) throw new FeedbackValidationError("invalid_translation", "Every question needs a German prompt.");
  const optionLabels = Object.fromEntries(questions.filter((question) => question.kind === "choice").map((question) => {
    const labels = value.optionLabels[question.id];
    if (!labels || labels.length !== question.options?.length || labels.some((label) => !label.trim() || label.length > 120)) throw new FeedbackValidationError("invalid_translation", "Translated choice labels must match the available choices.");
    const cleaned = labels.map((label) => label.trim());
    if (cleaned.some(looksLikeMachineKey)) throw new FeedbackValidationError("invalid_translation", "Translated choices must use readable labels, not snake_case keys.");
    return [question.id, cleaned];
  }));
  return { title, introduction, questionPrompts, optionLabels };
}

function looksLikeMachineKey(value: string) { return /^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(value); }

export class FeedbackValidationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "FeedbackValidationError";
  }
}

export function assertFeedbackFormStatus(value: string): FeedbackFormStatus {
  if (value !== "draft" && value !== "active" && value !== "closed") throw new FeedbackValidationError("invalid_status", "The form status is invalid.");
  return value;
}

export function assertFeedbackReviewState(value: string): FeedbackReviewState {
  if (value !== "unread" && value !== "reviewed" && value !== "archived") throw new FeedbackValidationError("invalid_review_state", "The response state is invalid.");
  return value;
}

export function assertFeedbackFollowUpState(value: string): FeedbackFollowUpState {
  if (value !== "none" && value !== "wanted" && value !== "done") throw new FeedbackValidationError("invalid_follow_up_state", "The follow-up state is invalid.");
  return value;
}

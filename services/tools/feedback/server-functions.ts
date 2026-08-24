import { createServerFn, getGlobalStartContext } from "@tanstack/react-start";
import { requirePlatformSession } from "../src/auth-middleware.js";
import { assertFeedbackFollowUpState, assertFeedbackFormStatus, assertFeedbackReviewState, assertFeedbackText, feedbackLocale, localizeFeedbackForm, validateFeedbackQuestions, validateFeedbackTranslation, type FeedbackFollowUpState, type FeedbackFormStatus, type FeedbackQuestion, type FeedbackReviewState, type FeedbackTranslation } from "./domain.js";

function repository() {
  const runtime = getGlobalStartContext()?.runtime;
  if (!runtime) throw new Error("Feedback runtime is unavailable.");
  return runtime.feedback;
}

export const getFeedbackForms = createServerFn({ method: "GET" })
  .middleware([requirePlatformSession])
  .handler(() => repository().listForms());

export const getFeedbackFormPage = createServerFn({ method: "GET" })
  .middleware([requirePlatformSession])
  .validator((input: { formId: string }) => input)
  .handler(async ({ data }) => {
    const form = await repository().getForm(data.formId);
    if (!form) throw new Error("Feedback form not found.");
    return { form, submissions: await repository().listSubmissions(data.formId), publicOrigin: getGlobalStartContext()!.runtime.publicOrigin };
  });

export const getFeedbackSubmission = createServerFn({ method: "GET" })
  .middleware([requirePlatformSession])
  .validator((input: { submissionId: string }) => input)
  .handler(async ({ data }) => {
    const submission = await repository().getSubmission(data.submissionId);
    if (!submission) throw new Error("Feedback response not found.");
    return submission;
  });

export const getPublicFeedbackForm = createServerFn({ method: "GET" })
  .validator((input: { token: string; locale?: string }) => input)
  .handler(async ({ data }) => {
    const form = await repository().getPublicForm(data.token);
    return form ? localizeFeedbackForm(form, feedbackLocale(data.locale)) : undefined;
  });

export const createFeedbackForm = createServerFn({ method: "POST" })
  .middleware([requirePlatformSession])
  .validator((input: { title: string }) => input)
  .handler(({ data }) => repository().createForm({ title: assertFeedbackText(data.title, "title") }));

export const updateFeedbackForm = createServerFn({ method: "POST" })
  .middleware([requirePlatformSession])
  .validator((input: { formId: string; title: string; introduction: string; questions: readonly FeedbackQuestion[]; german: FeedbackTranslation }) => input)
  .handler(({ data }) => {
    const questions = validateFeedbackQuestions(data.questions);
    return repository().updateForm(data.formId, { title: assertFeedbackText(data.title, "title"), introduction: assertFeedbackText(data.introduction, "introduction"), questions, translations: { de: validateFeedbackTranslation(data.german, questions) } });
  });

export const setFeedbackFormStatus = createServerFn({ method: "POST" })
  .middleware([requirePlatformSession])
  .validator((input: { formId: string; status: FeedbackFormStatus }) => input)
  .handler(({ data }) => repository().setFormStatus(data.formId, assertFeedbackFormStatus(data.status)));

export const rotateFeedbackToken = createServerFn({ method: "POST" })
  .middleware([requirePlatformSession])
  .validator((input: { formId: string }) => input)
  .handler(({ data }) => repository().rotateToken(data.formId));

export const deleteFeedbackForm = createServerFn({ method: "POST" })
  .middleware([requirePlatformSession])
  .validator((input: { formId: string }) => input)
  .handler(({ data }) => repository().deleteForm(data.formId));

export const updateFeedbackSubmission = createServerFn({ method: "POST" })
  .middleware([requirePlatformSession])
  .validator((input: { submissionId: string; reviewState: FeedbackReviewState; followUpState: FeedbackFollowUpState }) => input)
  .handler(({ data }) => repository().updateSubmission(data.submissionId, { reviewState: assertFeedbackReviewState(data.reviewState), followUpState: assertFeedbackFollowUpState(data.followUpState) }));

export const deleteFeedbackSubmission = createServerFn({ method: "POST" })
  .middleware([requirePlatformSession])
  .validator((input: { submissionId: string }) => input)
  .handler(({ data }) => repository().deleteSubmission(data.submissionId));

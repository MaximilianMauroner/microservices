import { createServerFn, getGlobalStartContext } from "@tanstack/react-start";
import { requirePlatformSession } from "../src/auth-middleware.js";
import { assertFeedbackFollowUpState, assertFeedbackFormStatus, assertFeedbackLanguage, assertFeedbackReviewState, assertFeedbackText, localizeFeedbackForm, validateFeedbackQuestions, type FeedbackFollowUpState, type FeedbackFormStatus, type FeedbackLanguage, type FeedbackQuestion, type FeedbackReviewState } from "./domain.js";

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
  .validator((input: { token: string }) => input)
  .handler(async ({ data }) => {
    const form = await repository().getPublicForm(data.token);
    return form ? localizeFeedbackForm(form) : undefined;
  });

export const createFeedbackForm = createServerFn({ method: "POST" })
  .middleware([requirePlatformSession])
  .validator((input: { language: FeedbackLanguage }) => input)
  .handler(({ data }) => repository().createForm({ language: assertFeedbackLanguage(data.language) }));

export const updateFeedbackForm = createServerFn({ method: "POST" })
  .middleware([requirePlatformSession])
  .validator((input: { formId: string; language: FeedbackLanguage; title: string; introduction: string; questions: readonly FeedbackQuestion[] }) => input)
  .handler(({ data }) => {
    const questions = validateFeedbackQuestions(data.questions);
    return repository().updateForm(data.formId, { language: assertFeedbackLanguage(data.language), title: assertFeedbackText(data.title, "title"), introduction: assertFeedbackText(data.introduction, "introduction"), questions });
  });

export const setFeedbackFormStatus = createServerFn({ method: "POST" })
  .middleware([requirePlatformSession])
  .validator((input: { formId: string; status: FeedbackFormStatus }) => input)
  .handler(async ({ data }) => {
    const status = assertFeedbackFormStatus(data.status);
    if (status === "active") {
      const form = await repository().getForm(data.formId);
      if (!form) throw new Error("Feedback form not found.");
      assertFeedbackText(form.title, "title");
      assertFeedbackText(form.introduction, "introduction");
      validateFeedbackQuestions(form.questions);
    }
    return repository().setFormStatus(data.formId, status);
  });

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

import { createServerFn, getGlobalStartContext } from "@tanstack/react-start";
import { requireProductAccess } from "../src/auth-middleware.js";
import { assertFeedbackFollowUpState, assertFeedbackFormStatus, assertFeedbackLanguage, assertFeedbackReviewState, assertFeedbackText, localizeFeedbackForm, validateFeedbackQuestions, type FeedbackFollowUpState, type FeedbackFormStatus, type FeedbackLanguage, type FeedbackQuestion, type FeedbackReviewState } from "./domain.js";

const feedbackSession = requireProductAccess("feedback");

function feedback() {
  const runtime = getGlobalStartContext()?.runtime;
  if (!runtime) throw new Error("Feedback runtime is unavailable.");
  return runtime.feedback;
}

export const getFeedbackForms = createServerFn({ method: "GET" })
  .middleware([feedbackSession])
  .handler(({ context }) => mine(context).listForms());

export const getFeedbackInbox = createServerFn({ method: "GET" })
  .middleware([feedbackSession])
  .handler(async ({ context }) => {
    const [forms, submissions] = await Promise.all([mine(context).listForms(), mine(context).listRecentSubmissions(200)]);
    return { forms, submissions };
  });

export const getFeedbackFormPage = createServerFn({ method: "GET" })
  .middleware([feedbackSession])
  .validator((input: { formId: string }) => input)
  .handler(async ({ data, context }) => {
    const form = await mine(context).getForm(data.formId);
    if (!form) throw new Error("Feedback form not found.");
    return { form, submissions: await mine(context).listSubmissions(data.formId), publicOrigin: getGlobalStartContext()!.runtime.publicOrigin };
  });

export const getFeedbackSubmission = createServerFn({ method: "GET" })
  .middleware([feedbackSession])
  .validator((input: { submissionId: string }) => input)
  .handler(async ({ data, context }) => {
    const submission = await mine(context).getSubmission(data.submissionId);
    if (!submission) throw new Error("Feedback response not found.");
    return submission;
  });

export const getPublicFeedbackForm = createServerFn({ method: "GET" })
  .validator((input: { token: string }) => input)
  .handler(async ({ data }) => {
    const form = await feedback().getPublicForm(data.token);
    return form ? { form: localizeFeedbackForm(form), publicOrigin: getGlobalStartContext()!.runtime.publicOrigin } : undefined;
  });

export const getSharedFeedbackResponse = createServerFn({ method: "GET" })
  .validator((input: { token: string }) => input)
  .handler(({ data }) => feedback().getSharedResponse(data.token));

export const createFeedbackForm = createServerFn({ method: "POST" })
  .middleware([feedbackSession])
  .validator((input: { language: FeedbackLanguage }) => input)
  .handler(({ data, context }) => mine(context).createForm({ language: assertFeedbackLanguage(data.language) }));

export const updateFeedbackForm = createServerFn({ method: "POST" })
  .middleware([feedbackSession])
  .validator((input: { formId: string; language: FeedbackLanguage; title: string; introduction: string; questions: readonly FeedbackQuestion[] }) => input)
  .handler(({ data, context }) => {
    const questions = validateFeedbackQuestions(data.questions);
    return mine(context).updateForm(data.formId, { language: assertFeedbackLanguage(data.language), title: assertFeedbackText(data.title, "title"), introduction: assertFeedbackText(data.introduction, "introduction"), questions });
  });

export const setFeedbackFormStatus = createServerFn({ method: "POST" })
  .middleware([feedbackSession])
  .validator((input: { formId: string; status: FeedbackFormStatus }) => input)
  .handler(async ({ data, context }) => {
    const status = assertFeedbackFormStatus(data.status);
    if (status === "active") {
      const form = await mine(context).getForm(data.formId);
      if (!form) throw new Error("Feedback form not found.");
      assertFeedbackText(form.title, "title");
      assertFeedbackText(form.introduction, "introduction");
      validateFeedbackQuestions(form.questions);
    }
    return mine(context).setFormStatus(data.formId, status);
  });

export const rotateFeedbackToken = createServerFn({ method: "POST" })
  .middleware([feedbackSession])
  .validator((input: { formId: string }) => input)
  .handler(({ data, context }) => mine(context).rotateToken(data.formId));

export const deleteFeedbackForm = createServerFn({ method: "POST" })
  .middleware([feedbackSession])
  .validator((input: { formId: string }) => input)
  .handler(({ data, context }) => mine(context).deleteForm(data.formId));

export const updateFeedbackSubmission = createServerFn({ method: "POST" })
  .middleware([feedbackSession])
  .validator((input: { submissionId: string; reviewState: FeedbackReviewState; followUpState: FeedbackFollowUpState }) => input)
  .handler(({ data, context }) => mine(context).updateSubmission(data.submissionId, { reviewState: assertFeedbackReviewState(data.reviewState), followUpState: assertFeedbackFollowUpState(data.followUpState) }));

export const deleteFeedbackSubmission = createServerFn({ method: "POST" })
  .middleware([feedbackSession])
  .validator((input: { submissionId: string }) => input)
  .handler(({ data, context }) => mine(context).deleteSubmission(data.submissionId));

function mine(context: { principal: { subject: string } }) {
  return feedback().owner(context.principal.subject);
}

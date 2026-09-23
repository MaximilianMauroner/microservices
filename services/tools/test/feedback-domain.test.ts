import { describe, expect, it } from "vitest";
import { FEEDBACK_TEMPLATE, FeedbackValidationError, feedbackChoiceDetailsKey, localizeFeedbackForm, parseFeedbackShareDays, validateFeedbackAnswers, validateFeedbackQuestions, wantsFeedbackFollowUp, type FeedbackForm } from "../feedback/domain.js";
import { addFeedbackFollowUpQuestions } from "../feedback/question-editor.js";

describe("feedback answer validation", () => {
  it("accepts only the offered sharing periods", () => {
    expect(parseFeedbackShareDays(null)).toBeUndefined();
    expect(parseFeedbackShareDays("1")).toBe(1);
    expect(parseFeedbackShareDays("7")).toBe(7);
    expect(parseFeedbackShareDays("30")).toBe(30);
    expect(() => parseFeedbackShareDays("365")).toThrow(FeedbackValidationError);
  });
  it("accepts a partial anonymous response", () => {
    expect(validateFeedbackAnswers(FEEDBACK_TEMPLATE, { comfort: "Mixed", disliked: "  Please stop interrupting me.  " })).toEqual({ comfort: "Mixed", disliked: "Please stop interrupting me." });
  });

  it("accepts optional context for a choice answer", () => {
    const detailsKey = feedbackChoiceDetailsKey("comfort");
    expect(validateFeedbackAnswers(FEEDBACK_TEMPLATE, { comfort: "Mixed", [detailsKey]: "  I needed more quiet time.  " })).toEqual({ comfort: "Mixed", [detailsKey]: "I needed more quiet time." });
    expect(validateFeedbackAnswers(FEEDBACK_TEMPLATE, { [detailsKey]: "The options did not quite fit." })).toEqual({ [detailsKey]: "The options did not quite fit." });
  });

  it("rejects empty, unknown, and invalid choice answers", () => {
    expect(() => validateFeedbackAnswers(FEEDBACK_TEMPLATE, {})).toThrowError(FeedbackValidationError);
    expect(() => validateFeedbackAnswers(FEEDBACK_TEMPLATE, { surprise: "value" })).toThrow("unknown answer");
    expect(() => validateFeedbackAnswers(FEEDBACK_TEMPLATE, { "details:disliked": "Not a choice question" })).toThrow("unknown answer");
    expect(() => validateFeedbackAnswers(FEEDBACK_TEMPLATE, { comfort: "Perfect" })).toThrow("not available");
  });

  it("ignores the honeypot field during answer validation", () => {
    expect(validateFeedbackAnswers(FEEDBACK_TEMPLATE, { website: "", enjoyed: "The walk" })).toEqual({ enjoyed: "The walk" });
  });

  it("allows the optional identity question to be removed", () => {
    const questions = validateFeedbackQuestions(FEEDBACK_TEMPLATE.filter((question) => question.id !== "identity"));
    expect(questions.some((question) => question.id === "identity")).toBe(false);
  });

  it("requires contact information only when a respondent requests follow-up", () => {
    const questions = addFeedbackFollowUpQuestions([], "en");
    expect(validateFeedbackAnswers(questions, { follow_up: "No, thanks" })).toEqual({ follow_up: "No, thanks" });
    expect(() => validateFeedbackAnswers(questions, { follow_up: "A meeting" })).toThrow("Add a way to contact you");
    const answers = validateFeedbackAnswers(questions, { follow_up: "A meeting", follow_up_contact: "  alex@example.test  " });
    expect(answers.follow_up_contact).toBe("alex@example.test");
    expect(wantsFeedbackFollowUp(questions, answers)).toBe(true);
    expect(wantsFeedbackFollowUp(questions, { follow_up: "No, thanks" })).toBe(false);
  });

  it("uses the form's one selected language", () => {
    const form = { id: "form", publicToken: "token", language: "de", title: "Feedback", introduction: "Intro", questions: FEEDBACK_TEMPLATE, status: "active", createdAt: "2026-08-24T12:00:00.000Z", updatedAt: "2026-08-24T12:00:00.000Z", responseCount: 0, unreadCount: 0 } satisfies FeedbackForm;
    const localized = localizeFeedbackForm(form);
    expect(localized.locale).toBe("de");
    expect(localized.title).toBe("Feedback");
  });
});

import { describe, expect, it } from "vitest";
import { FEEDBACK_TEMPLATE, FeedbackValidationError, localizeFeedbackForm, validateFeedbackAnswers, validateFeedbackQuestions, type FeedbackForm } from "../feedback/domain.js";

describe("feedback answer validation", () => {
  it("accepts a partial anonymous response", () => {
    expect(validateFeedbackAnswers(FEEDBACK_TEMPLATE, { comfort: "Mixed", disliked: "  Please stop interrupting me.  " })).toEqual({ comfort: "Mixed", disliked: "Please stop interrupting me." });
  });

  it("rejects empty, unknown, and invalid choice answers", () => {
    expect(() => validateFeedbackAnswers(FEEDBACK_TEMPLATE, {})).toThrowError(FeedbackValidationError);
    expect(() => validateFeedbackAnswers(FEEDBACK_TEMPLATE, { surprise: "value" })).toThrow("unknown answer");
    expect(() => validateFeedbackAnswers(FEEDBACK_TEMPLATE, { comfort: "Perfect" })).toThrow("not available");
  });

  it("ignores the honeypot field during answer validation", () => {
    expect(validateFeedbackAnswers(FEEDBACK_TEMPLATE, { website: "", enjoyed: "The walk" })).toEqual({ enjoyed: "The walk" });
  });

  it("allows the optional identity question to be removed", () => {
    const questions = validateFeedbackQuestions(FEEDBACK_TEMPLATE.filter((question) => question.id !== "identity"));
    expect(questions.some((question) => question.id === "identity")).toBe(false);
  });

  it("uses the form's one selected language", () => {
    const form = { id: "form", publicToken: "token", language: "de", title: "Feedback", introduction: "Intro", questions: FEEDBACK_TEMPLATE, status: "active", createdAt: "2026-08-24T12:00:00.000Z", updatedAt: "2026-08-24T12:00:00.000Z", responseCount: 0, unreadCount: 0 } satisfies FeedbackForm;
    const localized = localizeFeedbackForm(form);
    expect(localized.locale).toBe("de");
    expect(localized.title).toBe("Feedback");
  });
});

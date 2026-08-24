import { describe, expect, it } from "vitest";
import { FEEDBACK_TEMPLATE, FeedbackValidationError, validateFeedbackAnswers } from "../feedback/domain.js";

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
});

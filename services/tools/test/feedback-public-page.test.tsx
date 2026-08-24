import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_FEEDBACK_INTRODUCTION, DEFAULT_GERMAN_TRANSLATION, FEEDBACK_TEMPLATE, localizeFeedbackForm, type FeedbackForm } from "../feedback/domain.js";
import { PublicFeedbackPage } from "../feedback/public-page.js";
import { parsePublicFeedbackSearch } from "../feedback/public-search.js";

const form = { id: "form", publicToken: "token", title: "Feedback", introduction: DEFAULT_FEEDBACK_INTRODUCTION, questions: FEEDBACK_TEMPLATE, translations: { de: DEFAULT_GERMAN_TRANSLATION }, status: "active", createdAt: "2026-08-24T12:00:00.000Z", updatedAt: "2026-08-24T12:00:00.000Z", responseCount: 0, unreadCount: 0 } satisfies FeedbackForm;

describe("public feedback confirmation", () => {
  it("keeps the submitted flag when TanStack parses it as a number", () => {
    expect(parsePublicFeedbackSearch({ lang: "en", submitted: 1 })).toEqual({ lang: "en", submitted: true, error: undefined });
  });

  it("renders the animated English thank-you state", () => {
    const html = renderToStaticMarkup(<PublicFeedbackPage form={localizeFeedbackForm(form, "en")} submitted />);
    expect(html).toContain("Thank you for sharing");
    expect(html).toContain("LEVEL UP");
    expect(html.match(/\+1/g)).toHaveLength(5);
    expect(html).toContain("feedback-success-heart");
    expect(html).toContain("feedback-success-meter");
  });

  it("renders the German thank-you copy", () => {
    const html = renderToStaticMarkup(<PublicFeedbackPage form={localizeFeedbackForm(form, "de")} submitted />);
    expect(html).toContain("Danke fürs Teilen");
    expect(html).toContain("LEVEL UP");
    expect(html).not.toContain("+1 Vertrauen");
    expect(html).toContain("Du kannst die Seite jetzt schließen.");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_FEEDBACK_INTRODUCTION, FEEDBACK_TEMPLATE, localizeFeedbackForm, type FeedbackForm } from "../feedback/domain.js";
import { PublicFeedbackPage } from "../feedback/public-page.js";
import { parsePublicFeedbackSearch } from "../feedback/public-search.js";

const form = { id: "form", publicToken: "token", language: "en", title: "Feedback", introduction: DEFAULT_FEEDBACK_INTRODUCTION, questions: FEEDBACK_TEMPLATE, status: "active", createdAt: "2026-08-24T12:00:00.000Z", updatedAt: "2026-08-24T12:00:00.000Z", responseCount: 0, unreadCount: 0 } satisfies FeedbackForm;
const germanForm = { ...form, language: "de", title: "Rückmeldung", introduction: "Danke für deine Zeit." } satisfies FeedbackForm;

describe("public feedback confirmation", () => {
  it("keeps the submitted flag when TanStack parses it as a number", () => {
    expect(parsePublicFeedbackSearch({ submitted: 1 })).toEqual({ submitted: true, error: undefined });
  });

  it("renders the animated English thank-you state", () => {
    const html = renderToStaticMarkup(<PublicFeedbackPage form={localizeFeedbackForm(form)} submitted />);
    expect(html).toContain("Thank you for sharing");
    expect(html).toContain("LEVEL UP");
    expect(html.match(/\+1/g)).toHaveLength(5);
    expect(html).toContain("feedback-success-heart");
    expect(html).toContain("feedback-success-meter");
  });

  it("renders the German thank-you copy", () => {
    const html = renderToStaticMarkup(<PublicFeedbackPage form={localizeFeedbackForm(germanForm)} submitted />);
    expect(html).toContain("Danke fürs Teilen");
    expect(html).toContain("LEVEL UP");
    expect(html).not.toContain("+1 Vertrauen");
    expect(html).toContain("Du kannst die Seite jetzt schließen.");
  });

  it("uses the form language without rendering a language switch", () => {
    const html = renderToStaticMarkup(<PublicFeedbackPage form={localizeFeedbackForm(germanForm)} submitted={false} />);
    expect(html).toContain("Rückmeldung senden");
    expect(html).toContain("Alle Fragen sind freiwillig");
    expect(html).toContain("Möchtest du deine Auswahl näher erklären?");
    expect(html).toContain('name="details:comfort"');
    expect(html).not.toContain("English");
    expect(html).not.toContain("Deutsch");
    expect(html).not.toContain("Send feedback");
  });

  it("offers an optional explanation after every choice question", () => {
    const html = renderToStaticMarkup(<PublicFeedbackPage form={localizeFeedbackForm(form)} submitted={false} />);
    expect(html.match(/Would you like to explain your choice\?/g)).toHaveLength(2);
    expect(html).toContain('name="details:comfort"');
    expect(html).toContain('name="details:follow_up"');
  });
});

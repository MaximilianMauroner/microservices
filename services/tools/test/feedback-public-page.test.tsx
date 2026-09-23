import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_FEEDBACK_INTRODUCTION, FEEDBACK_TEMPLATE, localizeFeedbackForm, type FeedbackForm } from "../feedback/domain.js";
import { PublicFeedbackPage, SharedFeedbackResponsePage } from "../feedback/public-page.js";
import { parsePublicFeedbackSearch } from "../feedback/public-search.js";
import { addFeedbackFollowUpQuestions } from "../feedback/question-editor.js";

const form = { id: "form", publicToken: "token", language: "en", title: "Feedback", introduction: DEFAULT_FEEDBACK_INTRODUCTION, questions: FEEDBACK_TEMPLATE, status: "active", createdAt: "2026-08-24T12:00:00.000Z", updatedAt: "2026-08-24T12:00:00.000Z", responseCount: 0, unreadCount: 0 } satisfies FeedbackForm;
const germanForm = { ...form, language: "de", title: "Rückmeldung", introduction: "Danke für deine Zeit." } satisfies FeedbackForm;

describe("public feedback confirmation", () => {
  it("keeps the submitted flag when TanStack parses it as a number", () => {
    expect(parsePublicFeedbackSearch({ submitted: 1 })).toMatchObject({ submitted: true, error: undefined });
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

  it("offers optional link expiry and shows a completed response link", () => {
    const formHtml = renderToStaticMarkup(<PublicFeedbackPage form={localizeFeedbackForm(form)} submitted={false} />);
    expect(formHtml).toContain('name="__share_days"');
    expect(formHtml).toContain('value="30"');
    const thanksHtml = renderToStaticMarkup(<PublicFeedbackPage form={localizeFeedbackForm(form)} submitted shareUrl="https://tools.example.test/feedback/share/token" shareExpiresAt="2026-10-01T12:00:00.000Z" />);
    expect(thanksHtml).toContain("Keep this link");
    expect(thanksHtml).toContain("https://tools.example.test/feedback/share/token");
  });

  it("shows only the shared answer snapshot on the response page", () => {
    const html = renderToStaticMarkup(<SharedFeedbackResponsePage response={{ formTitle: "Feedback", language: "en", questionSnapshot: [{ id: "comfort", kind: "choice", prompt: "How was it?", options: ["Good", "Bad"] }], answers: { comfort: "Good", "details:comfort": "I felt welcome" }, submittedAt: "2026-09-23T12:00:00.000Z", expiresAt: "2026-09-30T12:00:00.000Z" }} />);
    expect(html).toContain("How was it?");
    expect(html).toContain("I felt welcome");
    expect(html).not.toContain("Mark reviewed");
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

  it("explains the contact requirement when the form offers a meeting", () => {
    const meetingForm = { ...form, questions: addFeedbackFollowUpQuestions([], "en") };
    const html = renderToStaticMarkup(<PublicFeedbackPage form={localizeFeedbackForm(meetingForm)} submitted={false} error="follow_up_contact_required" />);
    expect(html).toContain("A meeting");
    expect(html).toContain("Add a way to contact you for the follow-up or meeting.");
    expect(html).toContain("If you request follow-up or a meeting, add contact details.");
  });
});

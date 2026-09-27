import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FeedbackForm, FeedbackSubmission } from "../feedback/domain.js";
import { FeedbackHome, FeedbackInbox } from "../feedback/ui.js";

const form: FeedbackForm = {
  id: "form-1", publicToken: "token", language: "en", title: "Workshop", introduction: "Tell us what worked.",
  questions: [{ id: "comfort", kind: "choice", prompt: "How was it?", options: ["Good", "Mixed"] }],
  status: "active", createdAt: "2026-09-27T08:00:00.000Z", updatedAt: "2026-09-27T09:00:00.000Z", responseCount: 1, unreadCount: 1
};
const response: FeedbackSubmission = {
  id: "response-1", formId: form.id, formTitle: form.title, questionSnapshot: form.questions,
  answers: { comfort: "Mixed" }, submittedAt: "2026-09-27T09:30:00.000Z", reviewState: "unread", followUpState: "wanted"
};

describe("Feedback A3 views", () => {
  it("shows a cross-form reader with filters and private response content", () => {
    const html = renderToStaticMarkup(<FeedbackInbox forms={[form]} submissions={[response]} />);
    expect(html).toContain(">Responses</h1>");
    expect(html).toContain("1 unread in 1 form");
    expect(html).toContain('aria-label="Response inbox"');
    expect(html).toContain("How was it?");
    expect(html).toContain("Mixed");
    expect(html).toContain('aria-label="Select response from Anonymous"');
  });

  it("shows forms as a compact selectable table", () => {
    const html = renderToStaticMarkup(<FeedbackHome forms={[form]} />);
    expect(html).toContain(">Forms</h1>");
    expect(html).toContain('aria-label="Feedback forms"');
    expect(html).toContain('aria-label="Select all forms"');
    expect(html).toContain("Workshop");
    expect(html).toContain("New form");
  });
});

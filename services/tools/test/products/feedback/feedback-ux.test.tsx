// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localizeFeedbackForm, type FeedbackForm, type FeedbackSubmission } from "../../../products/feedback/domain.js";

const update = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@tanstack/react-router", () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>, useRouter: () => ({ invalidate: vi.fn() }), useNavigate: () => vi.fn(), useBlocker: vi.fn() }));
vi.mock("../../../platform/ui/components/app-shell.js", () => ({ AppShell: () => null }));
vi.mock("../../../products/feedback/server-functions.js", () => ({ updateFeedbackSubmission: update, createFeedbackForm: vi.fn(), deleteFeedbackForm: vi.fn(), deleteFeedbackSubmission: vi.fn(), rotateFeedbackToken: vi.fn(), setFeedbackFormStatus: vi.fn(), updateFeedbackForm: vi.fn() }));
import { FeedbackHome, FeedbackInbox, FeedbackResponsePage } from "../../../products/feedback/ui.js";
import { PublicFeedbackPage } from "../../../products/feedback/public-page.js";

const form: FeedbackForm = { id: "form", publicToken: "token", language: "en", title: "Feedback", introduction: "Intro", questions: [{ id: "answer", kind: "short_text", prompt: "Your answer" }], status: "active", createdAt: "2026-09-27T08:00:00Z", updatedAt: "2026-09-27T08:00:00Z", responseCount: 1, unreadCount: 1 };
const submission: FeedbackSubmission = { id: "response", formId: form.id, formTitle: form.title, questionSnapshot: form.questions, answers: { answer: "Hello" }, submittedAt: "2026-09-27T08:00:00Z", reviewState: "unread", followUpState: "done" };

describe("feedback recovery and actions", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); update.mockClear(); });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
  it("keeps an answer and offers a retry when submission fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await act(async () => root.render(<PublicFeedbackPage form={localizeFeedbackForm(form)} submitted={false} />));
    const input = container.querySelector<HTMLInputElement>('[name="answer"]')!;
    input.value = "My answer";
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("try again");
    expect(input.value).toBe("My answer");
  });
  it("offers follow-up actions only for requested follow-ups and reopens them in both views", async () => {
    await act(async () => root.render(<FeedbackInbox forms={[form]} submissions={[submission]} />));
    const reopen = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Reopen follow-up")!;
    await act(async () => reopen.click());
    expect(update).toHaveBeenLastCalledWith({ data: { submissionId: "response", reviewState: "unread", followUpState: "wanted" } });
    await act(async () => root.render(<FeedbackInbox forms={[form]} submissions={[{ ...submission, followUpState: "none" }]} />));
    expect(container.textContent).not.toContain("Follow-up done");
    await act(async () => root.render(<FeedbackResponsePage submission={submission} />));
    await act(async () => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Reopen follow-up")!.click());
    expect(update).toHaveBeenLastCalledWith({ data: { submissionId: "response", reviewState: "unread", followUpState: "wanted" } });
    await act(async () => root.render(<FeedbackResponsePage submission={{ ...submission, followUpState: "none" }} />));
    expect(container.textContent).not.toContain("follow-up");
  });
  it("dismisses the new form menu with Escape", async () => {
    await act(async () => root.render(<FeedbackHome forms={[]} />));
    await act(async () => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "New form")!.click());
    expect(document.body.textContent).toContain("English form");
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.body.textContent).not.toContain("English form");
  });
});

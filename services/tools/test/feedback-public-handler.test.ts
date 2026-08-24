import { describe, expect, it, vi } from "vitest";
import { submitPublicFeedback } from "../feedback/public-handler.js";
import { DEFAULT_FEEDBACK_INTRODUCTION, FEEDBACK_TEMPLATE, type FeedbackForm } from "../feedback/domain.js";

const form: FeedbackForm = { id: "d9a728ca-4953-44bd-bc46-c636fb6e39d4", publicToken: "token", language: "en", title: "Post-hangout feedback", introduction: DEFAULT_FEEDBACK_INTRODUCTION, questions: FEEDBACK_TEMPLATE, status: "active", createdAt: "2026-08-24T12:00:00.000Z", updatedAt: "2026-08-24T12:00:00.000Z", responseCount: 0, unreadCount: 0 };

describe("public feedback submission", () => {
  it("stores a valid same-origin response and redirects", async () => {
    const createSubmission = vi.fn().mockResolvedValue("submission-id");
    const response = await submitPublicFeedback(input(new Request("https://tools.example.test/feedback/f/token", { method: "POST", headers: { origin: "https://tools.example.test", "content-type": "application/x-www-form-urlencoded" }, body: "comfort=Mixed&disliked=Please+listen" }), { getPublicForm: vi.fn().mockResolvedValue(form), createSubmission }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/feedback/f/token?submitted=1");
    expect(createSubmission).toHaveBeenCalledWith(form, { comfort: "Mixed", disliked: "Please listen" }, expect.any(Array));
  });

  it("submits when a proxy strips the Origin header", async () => {
    const createSubmission = vi.fn().mockResolvedValue("submission-id");
    const request = new Request("http://internal.example.test/feedback/f/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "comfort=Mixed" });
    const response = await submitPublicFeedback(input(request, { getPublicForm: vi.fn().mockResolvedValue(form), createSubmission }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/feedback/f/token?submitted=1");
    expect(createSubmission).toHaveBeenCalledOnce();
  });

  it("uses the capability token instead of the Origin header", async () => {
    const createSubmission = vi.fn().mockResolvedValue("submission-id");
    const request = new Request("https://tools.example.test/feedback/f/token", { method: "POST", headers: { origin: "https://other.example.test", "content-type": "application/x-www-form-urlencoded" }, body: "comfort=Mixed" });
    const response = await submitPublicFeedback(input(request, { getPublicForm: vi.fn().mockResolvedValue(form), createSubmission }));
    expect(response.status).toBe(303);
    expect(createSubmission).toHaveBeenCalledOnce();
  });

  it("snapshots the form's canonical question text", async () => {
    const createSubmission = vi.fn().mockResolvedValue("submission-id");
    await submitPublicFeedback(input(new Request("https://tools.example.test/feedback/f/token", { method: "POST", headers: { origin: "https://tools.example.test", "content-type": "application/x-www-form-urlencoded" }, body: "comfort=Mixed" }), { getPublicForm: vi.fn().mockResolvedValue(form), createSubmission }));
    expect(createSubmission.mock.calls[0]?.[2][0].prompt).toBe("How did you feel during our hangout?");
    expect(createSubmission.mock.calls[0]?.[1]).toEqual({ comfort: "Mixed" });
  });

  it("returns to the form instead of showing JSON when storage fails", async () => {
    const response = await submitPublicFeedback(input(new Request("https://tools.example.test/feedback/f/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "comfort=Mixed" }), {
      getPublicForm: vi.fn().mockResolvedValue(form),
      createSubmission: vi.fn().mockRejectedValue(new Error("database unavailable")),
    }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/feedback/f/token?error=submission_failed");
  });

  it("does not insert honeypot submissions", async () => {
    const createSubmission = vi.fn();
    const response = await submitPublicFeedback(input(new Request("https://tools.example.test/feedback/f/token", { method: "POST", headers: { origin: "https://tools.example.test", "content-type": "application/x-www-form-urlencoded" }, body: "website=spam.example&comfort=Mixed" }), { getPublicForm: vi.fn(), createSubmission }));
    expect(response.status).toBe(303);
    expect(createSubmission).not.toHaveBeenCalled();
  });
});

function input(request: Request, feedback: { getPublicForm: ReturnType<typeof vi.fn>; createSubmission: ReturnType<typeof vi.fn> }) {
  return { request, params: { token: "token" }, context: { runtime: { publicOrigin: "https://tools.example.test", feedback } } } as unknown as Parameters<typeof submitPublicFeedback>[0];
}

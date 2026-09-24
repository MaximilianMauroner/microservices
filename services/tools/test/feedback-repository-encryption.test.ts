import { randomBytes } from "node:crypto";
import type { Sql } from "postgres";
import { describe, expect, it } from "vitest";
import { FEEDBACK_TEMPLATE, type FeedbackForm } from "../feedback/domain.js";
import { isEncryptedFeedbackValue } from "../feedback/encryption.js";
import { feedbackRepository } from "../feedback/repository.js";

const form: FeedbackForm = {
  id: "61c26d83-b63d-4b84-9d31-4ba2e27b6713", publicToken: "public", language: "en", title: "Feedback",
  introduction: "Tell me what you think", questions: FEEDBACK_TEMPLATE, status: "active",
  createdAt: "2026-09-23T12:00:00.000Z", updatedAt: "2026-09-23T12:00:00.000Z", responseCount: 0, unreadCount: 0,
};

describe("Feedback repository encryption boundary", () => {
  it("stores only ciphertext and decrypts authorized response reads", async () => {
    let stored: unknown[] = [];
    const query = Object.assign((strings: TemplateStringsArray, ...values: unknown[]) => {
      const statement = strings.join("?");
      if (statement.includes("insert into tools.feedback_submissions")) stored = values;
      if (statement.includes("where s.id =")) return Promise.resolve([{
        id: stored[0], form_id: form.id, form_title: form.title, question_snapshot: stored[2], answers: stored[3],
        submitted_at: new Date(), review_state: "unread", follow_up_state: "none",
      }]);
      return Promise.resolve([]);
    }, { json: (value: unknown) => value }) as unknown as Sql;
    const repository = feedbackRepository(query, randomBytes(32));
    const answers = { identity: "Alex", disliked: "Private comment" };

    const created = await repository.createSubmission(form, answers);
    expect(isEncryptedFeedbackValue(stored[2])).toBe(true);
    expect(isEncryptedFeedbackValue(stored[3])).toBe(true);
    expect(JSON.stringify(stored)).not.toContain("Private comment");
    expect((await repository.getSubmission(created.id))?.answers).toEqual(answers);
    expect((await repository.getSubmission(created.id))?.questionSnapshot).toEqual(FEEDBACK_TEMPLATE);
  });
});

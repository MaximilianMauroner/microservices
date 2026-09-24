import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createFeedbackEncryption, encryptExistingFeedbackValue, isEncryptedFeedbackValue, parseFeedbackEncryptionKey } from "../feedback/encryption.js";

const key = randomBytes(32);
const encryption = createFeedbackEncryption(key);
const submissionId = "eae1669d-1f8f-4f92-a5d8-11e23bef364b";

describe("Feedback response encryption", () => {
  it("requires a dedicated 32-byte key", () => {
    expect(parseFeedbackEncryptionKey(key.toString("base64url"))).toEqual(key);
    expect(() => parseFeedbackEncryptionKey(undefined)).toThrow("FEEDBACK_ENCRYPTION_KEY");
    expect(() => parseFeedbackEncryptionKey("too-short")).toThrow("32-byte key");
  });

  it("encrypts answer content with a fresh nonce and decrypts it for authorized reads", () => {
    const answers = { identity: "Alex", follow_up_contact: "alex@example.test", comment: "Private details" };
    const first = encryption.encrypt(answers, submissionId, "answers");
    const second = encryption.encrypt(answers, submissionId, "answers");
    expect(isEncryptedFeedbackValue(first)).toBe(true);
    expect(JSON.stringify(first)).not.toContain("alex@example.test");
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(encryption.decrypt(first, submissionId, "answers")).toEqual(answers);
  });

  it("rejects altered ciphertext, the wrong row, field, or key", () => {
    const encrypted = encryption.encrypt({ answer: "secret" }, submissionId, "answers");
    expect(() => encryption.decrypt({ ...encrypted, ciphertext: Buffer.from("tampered").toString("base64url") }, submissionId, "answers")).toThrow();
    expect(() => encryption.decrypt(encrypted, "another-submission", "answers")).toThrow();
    expect(() => encryption.decrypt(encrypted, submissionId, "question_snapshot")).toThrow();
    expect(() => createFeedbackEncryption(randomBytes(32)).decrypt(encrypted, submissionId, "answers")).toThrow();
  });

  it("keeps legacy plaintext readable during the backfill", () => {
    const oldAnswers = { comment: "Older response" };
    expect(encryption.decrypt(oldAnswers, submissionId, "answers")).toEqual(oldAnswers);
    const migrated = encryptExistingFeedbackValue(oldAnswers, submissionId, "answers", encryption);
    expect(encryption.decrypt(migrated, submissionId, "answers")).toEqual(oldAnswers);
    expect(encryptExistingFeedbackValue(migrated, submissionId, "answers", encryption)).toBe(migrated);
  });
});

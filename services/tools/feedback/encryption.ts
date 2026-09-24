import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const MARKER = "__feedback_encrypted";
const VERSION = 1;

type EncryptedValue = Readonly<{
  __feedback_encrypted: 1;
  nonce: string;
  ciphertext: string;
  tag: string;
}>;

export function parseFeedbackEncryptionKey(value: string | undefined): Buffer {
  if (!value) throw new Error("Missing required environment variable: FEEDBACK_ENCRYPTION_KEY");
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error("FEEDBACK_ENCRYPTION_KEY must be a base64url-encoded 32-byte key");
  const key = Buffer.from(value, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== value) throw new Error("FEEDBACK_ENCRYPTION_KEY must be a base64url-encoded 32-byte key");
  return key;
}

export function isEncryptedFeedbackValue(value: unknown): value is EncryptedValue {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && MARKER in value);
}

export function createFeedbackEncryption(key: Buffer) {
  if (key.length !== 32) throw new Error("Feedback encryption needs a 32-byte key");
  function associatedData(submissionId: string, field: "answers" | "question_snapshot") {
    return Buffer.from(`feedback:v${VERSION}:${submissionId}:${field}`, "utf8");
  }
  return {
    encrypt(value: unknown, submissionId: string, field: "answers" | "question_snapshot"): EncryptedValue {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(associatedData(submissionId, field));
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
      return { [MARKER]: VERSION, nonce: nonce.toString("base64url"), ciphertext: ciphertext.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") } as EncryptedValue;
    },
    decrypt<T>(value: unknown, submissionId: string, field: "answers" | "question_snapshot"): T {
      if (!isEncryptedFeedbackValue(value)) return value as T;
      if (value.__feedback_encrypted !== VERSION || typeof value.nonce !== "string" || typeof value.ciphertext !== "string" || typeof value.tag !== "string") {
        throw new Error("Unsupported Feedback encryption payload");
      }
      const nonce = Buffer.from(value.nonce, "base64url");
      const tag = Buffer.from(value.tag, "base64url");
      if (nonce.length !== 12 || tag.length !== 16) throw new Error("Invalid Feedback encryption payload");
      const decipher = createDecipheriv("aes-256-gcm", key, nonce);
      decipher.setAAD(associatedData(submissionId, field));
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64url")), decipher.final()]);
      return JSON.parse(plaintext.toString("utf8")) as T;
    },
  };
}

export function encryptExistingFeedbackValue(value: unknown, submissionId: string, field: "answers" | "question_snapshot", encryption: ReturnType<typeof createFeedbackEncryption>): EncryptedValue {
  if (isEncryptedFeedbackValue(value)) {
    encryption.decrypt(value, submissionId, field);
    return value;
  }
  return encryption.encrypt(value, submissionId, field);
}

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Reads a base64url-encoded 32-byte key from an environment variable. */
export function parseEncryptionKey(name: string, value: string | undefined): Buffer {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error(`${name} must be a base64url-encoded 32-byte key`);
  const key = Buffer.from(value, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== value) throw new Error(`${name} must be a base64url-encoded 32-byte key`);
  return key;
}

const VERSION = "v1";

/**
 * Seals JSON values with AES-256-GCM as `v1.<nonce>.<ciphertext>.<tag>`. `context` names where the value
 * belongs, such as a table and a row id. Opening it with another context fails, so a sealed value
 * cannot be moved to another row or owner without notice.
 */
export function createSealer(key: Buffer, purpose: string) {
  if (key.length !== 32) throw new Error("Encryption needs a 32-byte key");
  const associated = (context: string) => Buffer.from(`${purpose}:${VERSION}:${context}`, "utf8");
  return {
    seal(value: unknown, context: string): string {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(associated(context));
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
      return [VERSION, nonce.toString("base64url"), ciphertext.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
    },
    open<T>(sealed: string, context: string): T {
      const [version, nonce, ciphertext, tag] = sealed.split(".");
      if (version !== VERSION || !nonce || ciphertext === undefined || !tag) throw new Error("Unsupported sealed value");
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonce, "base64url"));
      decipher.setAAD(associated(context));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]);
      return JSON.parse(plaintext.toString("utf8")) as T;
    }
  };
}

export type Sealer = ReturnType<typeof createSealer>;

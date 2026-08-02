import crypto from "node:crypto";
import { lstatSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

type Environment = Record<string, string | undefined>;

export function resolveSQLitePushPath(environment: Environment) {
  const path = environment.SQLITE_PATH?.trim();
  if (!path || !isAbsolute(path)) throw new Error("SQLITE_PATH must be an explicit absolute path.");
  if (environment.FIELD_GUIDE_SQLITE_PUSH_CONFIRM !== "field-guide-console-sqlite") {
    throw new Error("SQLite schema push requires FIELD_GUIDE_SQLITE_PUSH_CONFIRM=field-guide-console-sqlite.");
  }
  return path;
}

export function createSQLitePushHandoff(environment: Environment) {
  const path = resolveSQLitePushPath(environment);
  const directory = mkdtempSync(join(tmpdir(), "field-guide-sqlite-push-"));
  const handoffPath = join(directory, "handoff.json");
  const nonce = crypto.randomBytes(32).toString("hex");
  const databaseHash = crypto.createHash("sha256").update(path).digest("hex");
  writeFileSync(handoffPath, JSON.stringify({ nonce, databaseHash }), {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return { directory, path: handoffPath, nonce };
}

export function consumeSQLitePushHandoff(environment: Environment) {
  const handoffPath = environment.FIELD_GUIDE_SQLITE_PUSH_HANDOFF?.trim();
  const nonce = environment.FIELD_GUIDE_SQLITE_PUSH_NONCE?.trim();
  if (!handoffPath || !nonce) {
    throw new Error("SQLite schema push must run through the guarded db:push-sqlite command.");
  }
  const metadata = lstatSync(handoffPath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
    throw new Error("SQLite schema push handoff is not a private regular file.");
  }
  if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
    throw new Error("SQLite schema push handoff has the wrong owner.");
  }
  const source = readFileSync(handoffPath, "utf8");
  unlinkSync(handoffPath);
  const payload = JSON.parse(source) as { nonce?: unknown; databaseHash?: unknown };
  const expectedNonce = Buffer.from(nonce);
  const actualNonce = Buffer.from(typeof payload.nonce === "string" ? payload.nonce : "");
  if (expectedNonce.length !== actualNonce.length || !crypto.timingSafeEqual(expectedNonce, actualNonce)) {
    throw new Error("SQLite schema push handoff is invalid.");
  }
  const path = resolveSQLitePushPath(environment);
  const databaseHash = crypto.createHash("sha256").update(path).digest("hex");
  if (payload.databaseHash !== databaseHash) throw new Error("SQLite schema push handoff database does not match.");
  return path;
}

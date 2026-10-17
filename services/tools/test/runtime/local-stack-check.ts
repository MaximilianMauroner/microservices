import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { loadPlatformConfig } from "../../src/config.ts";
import { createMultipartStorage } from "../../publisher/src/multipart-storage.ts";

function origin(value: string, name: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.username || url.password
    || url.pathname !== "/" || url.search || url.hash) throw new Error(`${name} must be an owned loopback origin.`);
  return url.origin;
}

function tokens(value: string | null) {
  return (value ?? "").split(",").map((token) => token.trim().toLowerCase());
}

async function storageCheck(config: ReturnType<typeof loadPlatformConfig>) {
  const bucket = createMultipartStorage(config.artifact.s3);
  const key = `local-stack-prerequisites/${randomUUID()}`;
  const signal = AbortSignal.timeout(35_000);
  try {
    const body = "owned local signed upload prerequisite";
    const upload = await bucket.create(key, { kind: "file", filename: "prerequisite.txt", contentType: "text/plain",
      totalBytes: Buffer.byteLength(body), partBytes: Buffer.byteLength(body) }, signal);
    const signed = await bucket.sign(key, upload, 1, Buffer.byteLength(body), 60);
    if (new URL(signed).origin !== config.artifact.s3.endpoint) throw new Error("Signing changed the owned storage endpoint.");
    const preflight = await fetch(signed, {
      method: "OPTIONS", signal, headers: { Origin: config.publicOrigin,
        "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type" },
    });
    const allowsOrigin = (response: Response) => ["*", config.publicOrigin].includes(response.headers.get("access-control-allow-origin") ?? "");
    const allowedHeaders = tokens(preflight.headers.get("access-control-allow-headers"));
    if (!preflight.ok || !allowsOrigin(preflight) || !tokens(preflight.headers.get("access-control-allow-methods")).includes("put")
      || !allowedHeaders.some((value) => value === "*" || value === "content-type")) throw new Error("Signed PUT preflight is unavailable.");
    await preflight.body?.cancel();
    const response = await fetch(signed, { method: "PUT", body, signal, headers: { Origin: config.publicOrigin, "Content-Type": "text/plain" } });
    const etag = response.headers.get("etag");
    const exposed = tokens(response.headers.get("access-control-expose-headers"));
    if (!response.ok || !allowsOrigin(response) || !etag || !exposed.some((value) => value === "*" || value === "etag")) {
      throw new Error("Signed PUT or exposed ETag is unavailable.");
    }
    await response.body?.cancel();
    const parts = await bucket.parts(key, upload, signal);
    if (parts.length !== 1 || parts[0]?.etag !== etag || parts[0]?.bytes !== Buffer.byteLength(body)) throw new Error("Storage did not retain the signed part and ETag.");
  } finally {
    try { await bucket.remove(key, AbortSignal.timeout(10_000)); }
    finally { bucket.close(); }
  }
}

try {
  const config = loadPlatformConfig(process.env);
  origin(config.publicOrigin, "PUBLIC_ORIGIN");
  origin(config.artifact.s3.endpoint, "ARTIFACT_S3_ENDPOINT");
  origin(config.tools.bucket.endpoint, "TOOLS_S3_ENDPOINT");
  const database = new URL(config.databaseUrl);
  if (database.hostname !== "127.0.0.1" || !database.port || !["postgres:", "postgresql:"].includes(database.protocol)) {
    throw new Error("DATABASE_URL must use the owned loopback database.");
  }
  switch (process.argv[2]) {
    case "config":
      process.stdout.write("config\n");
      break;
    case "health": {
      const deadline = AbortSignal.timeout(60_000);
      for (;;) {
        try {
          const responses = await Promise.all(["/live", "/health"].map((path) => fetch(new URL(path, config.publicOrigin), {
            signal: AbortSignal.any([deadline, AbortSignal.timeout(3_000)]), redirect: "error",
          })));
          const ready = responses.every((response) => response.status === 200);
          await Promise.all(responses.map((response) => response.body?.cancel()));
          if (ready) break;
        } catch { deadline.throwIfAborted(); }
        await delay(500, undefined, { signal: deadline });
      }
      process.stdout.write("health\n");
      break;
    }
    case "storage":
      try {
        await storageCheck(config);
        process.stdout.write("storage-http\n");
      } catch {
        process.stdout.write("storage-blocked\n");
      }
      break;
    default:
      throw new Error("Usage: local-stack-check.ts config|health|storage");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Local prerequisite failed.");
  process.exitCode = 1;
}

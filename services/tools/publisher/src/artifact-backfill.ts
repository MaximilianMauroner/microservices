import { HeadObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import postgres from "postgres";

/** Idempotently imports legacy S3 object metadata without changing object IDs or keys. */
export async function backfillArtifactMetadata(env: NodeJS.ProcessEnv = process.env) {
  const databaseUrl = required(env, "DATABASE_URL");
  const bucket = required(env, "ARTIFACT_S3_BUCKET");
  const client = new S3Client({
    endpoint: required(env, "ARTIFACT_S3_ENDPOINT"), region: required(env, "ARTIFACT_S3_REGION"),
    forcePathStyle: env.ARTIFACT_S3_FORCE_PATH_STYLE === "true",
    credentials: { accessKeyId: required(env, "ARTIFACT_S3_ACCESS_KEY_ID"), secretAccessKey: required(env, "ARTIFACT_S3_SECRET_ACCESS_KEY") }
  });
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    for (const prefix of ["pages/", "files/"] as const) {
      let continuationToken: string | undefined;
      do {
        const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }));
        for (const object of listed.Contents ?? []) {
          if (!object.Key) continue;
          const id = artifactId(object.Key, prefix);
          if (!id) continue;
          const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: object.Key }));
          const metadata = head.Metadata ?? {};
          const kind = prefix === "pages/" ? "html" : "file";
          const filename = decode(metadata["original-name-base64"]) ?? (kind === "html" ? `${id}.html` : `${id}.bin`);
          const contentType = head.ContentType ?? (kind === "html" ? "text/html; charset=utf-8" : "application/octet-stream");
          const updatedAt = object.LastModified ?? head.LastModified ?? new Date();
          const expiresAt = kind === "file" ? parseDate(metadata["expires-at"]) ?? head.Expires : undefined;
          await sql`
            insert into artifacts.objects
              (id, kind, filename, content_type, bytes, object_key, project, created_at, updated_at, expires_at)
            values (${id}, ${kind}, ${filename}, ${contentType}, ${head.ContentLength ?? object.Size ?? 0}, ${object.Key},
              ${decode(metadata["project-base64"]) ?? null}, ${updatedAt}, ${updatedAt}, ${expiresAt ?? null})
            on conflict (id) do nothing
          `;
        }
        continuationToken = listed.NextContinuationToken;
      } while (continuationToken);
    }
  } finally { client.destroy(); await sql.end(); }
}

export function artifactId(key: string, prefix: "pages/" | "files/") {
  const raw = prefix === "pages/" && key.endsWith(".html") ? key.slice(prefix.length, -5) : key.slice(prefix.length);
  return /^[A-Za-z0-9_-]{32}$/.test(raw) ? raw : undefined;
}
function decode(value: string | undefined) { if (!value) return undefined; return Buffer.from(value, "base64").toString("utf8"); }
function parseDate(value: string | undefined) { if (!value) return undefined; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? undefined : parsed; }
function required(env: NodeJS.ProcessEnv, name: string) { const value = env[name]?.trim(); if (!value) throw new Error(`${name} is required`); return value; }

import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const require = createRequire(new URL("../../../services/tools/publisher/package.json", import.meta.url));
const postgres = require("postgres");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const [state, label, id, source] = process.argv.slice(2);
const values = JSON.parse(await readFile(`${state}/environment.json`, "utf8"));
if (new URL(values.DATABASE_URL).hostname !== "127.0.0.1") throw new Error("Owned loopback database required");
const sql = postgres(values.DATABASE_URL, { max: 1 });
const client = new S3Client({ endpoint: values.ARTIFACT_S3_ENDPOINT, region: "us-east-1", forcePathStyle: true,
  credentials: { accessKeyId: values.ARTIFACT_S3_ACCESS_KEY_ID, secretAccessKey: values.ARTIFACT_S3_SECRET_ACCESS_KEY } });
try {
  const [row] = await sql`select * from artifacts.objects where id = ${id}`;
  const response = await client.send(new GetObjectCommand({ Bucket: values.ARTIFACT_S3_BUCKET, Key: row.object_key }));
  const bytes = await response.Body.transformToByteArray();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (!Buffer.from(bytes).equals(await readFile(source))) throw new Error("Raw storage body differs from the source fixture");
  if (sha256 !== row.sha256 || bytes.length !== Number(row.bytes)) throw new Error("Raw stored bytes do not match canonical metadata");
  await writeFile(`${state}/${label}.body`, bytes);
  await writeFile(`${state}/${label}.row.json`, JSON.stringify(row));
  if (label === "after") {
    const before = JSON.parse(await readFile(`${state}/before.row.json`, "utf8"));
    if (before.id !== row.id || before.created_at !== row.created_at.toISOString() || before.project !== row.project || before.object_key === row.object_key) {
      throw new Error("Replacement identity, creation time, project, or staging invariant failed");
    }
    const retained = await client.send(new GetObjectCommand({ Bucket: values.ARTIFACT_S3_BUCKET, Key: before.object_key }));
    const old = await retained.Body.transformToByteArray();
    if (createHash("sha256").update(old).digest("hex") !== before.sha256) throw new Error("Prior bytes were not retained");
    console.log("Raw current and prior body hashes, stable ID, project and creation time passed");
  }
} finally { await sql.end(); client.destroy(); }

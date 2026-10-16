import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const fixture = path.resolve(process.argv[2]);
assert.equal(JSON.parse(await readFile(path.join(fixture, 'owner.json'))).root, root);
const previous = (await readFile(path.join(fixture, 'recover-cli-run'), 'utf8')).trim();
const current = (await readFile(path.join(fixture, 'latest-cli-run'), 'utf8')).trim();
assert.notEqual(previous, current);
const failed = (await readFile(path.join(previous, 'cli-output.jsonl'), 'utf8')).trim().split('\n')
  .map(line => JSON.parse(line)).findLast(row => row.returncode !== 0 && row.stderr.includes("Cannot access 'ApiError' before initialization"));
assert(failed, 'The retained failed TS initialization is missing');
const source = path.join(previous, 'fixtures/original.html');
const bytes = await readFile(source);
const digest = value => createHash('sha256').update(value).digest('hex');
const env = JSON.parse(await readFile(path.join(current, 'environment.json'), 'utf8'));
assert.equal(new URL(env.DATABASE_URL).hostname, '127.0.0.1');
assert.equal(new URL(env.ARTIFACT_S3_ENDPOINT).hostname, '127.0.0.1');
assert.equal(env.ARTIFACT_S3_BUCKET, 'tools-transfer-test');
const require = createRequire(new URL('../../../services/tools/publisher/package.json', import.meta.url));
const sql = require('postgres')(env.DATABASE_URL, { max: 1 });
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const client = new S3Client({ endpoint: env.ARTIFACT_S3_ENDPOINT, region: env.ARTIFACT_S3_REGION, forcePathStyle: true,
  credentials: { accessKeyId: env.ARTIFACT_S3_ACCESS_KEY_ID, secretAccessKey: env.ARTIFACT_S3_SECRET_ACCESS_KEY } });
try {
  const [before] = await sql`select session_id, state, description from artifacts.upload_sessions where session_id = ${failed.request}::uuid`;
  assert(before, 'The accepted initialization no longer exists');
  assert.equal(Number(before.description.totalBytes), bytes.length);
  assert.notEqual(await readFile(path.join(previous, 'app.pid'), 'utf8'), await readFile(path.join(current, 'app.pid'), 'utf8'));
  const output = execFileSync(path.join(root, 'services/tools/publisher/node_modules/.bin/tsx'),
    ['services/tools/publisher/scripts/upload-direct.ts', source, failed.request],
    { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  await writeFile(path.join(current, 'ts-recovered-old-init.json'), output, { mode: 0o600 });
  const result = JSON.parse(output.trim().split('\n').at(-1));
  const [after] = await sql`select session_id, state, artifact_id from artifacts.upload_sessions where session_id = ${failed.request}::uuid`;
  assert.equal(after.session_id, before.session_id);
  assert.equal(after.state, 'completed');
  assert.equal(result.id, after.artifact_id);
  const [row] = await sql`select object_key, bytes, sha256 from artifacts.objects where id = ${result.id}`;
  const stored = await client.send(new GetObjectCommand({ Bucket: env.ARTIFACT_S3_BUCKET, Key: row.object_key }));
  const raw = Buffer.from(await stored.Body.transformToByteArray());
  assert(raw.equals(bytes));
  assert.equal(row.sha256, digest(bytes));
  assert.equal(result.sha256, digest(bytes));
  assert.equal(Number(row.bytes), bytes.length);
  assert((await readFile(source)).equals(bytes));
  const report = { exactFailedRequestResumedAcrossAppRestart: 'passed', priorState: before.state,
    finalState: after.state, sameSessionUuid: true, rawStoredDigest: 'passed', localSourceRetained: true };
  await writeFile(path.join(root, '.agents/artifacts/direct-upload-vm-20261016/ts-recovery-result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally { await sql.end(); client.destroy(); }

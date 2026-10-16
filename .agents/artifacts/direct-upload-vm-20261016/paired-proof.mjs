import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, cp, readlink } from 'node:fs/promises';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { configuration, preflight, backup, restore, verify } from '../../../services/tools/publisher/scripts/release-paired-backup.mjs';
const require = createRequire(new URL('../../../services/tools/publisher/package.json', import.meta.url));
const postgres = require('postgres');
const { S3Client, CreateBucketCommand, PutBucketTaggingCommand, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const root = process.cwd();
const fixture = path.resolve(process.argv[2]);
assert.equal(JSON.parse(await readFile(path.join(fixture, 'owner.json'))).root, root);
const run = (await readFile(path.join(fixture, 'latest-cli-run'), 'utf8')).trim();
const env = JSON.parse(await readFile(path.join(run, 'environment.json')));
assert.equal(new URL(env.DATABASE_URL).hostname, '127.0.0.1');
assert.equal(env.ARTIFACT_S3_BUCKET, 'tools-transfer-test');
const directory = path.join(fixture, 'paired-' + randomUUID());
await mkdir(directory, { mode: 0o700 });
const tmpdir = path.join(run, 'tmp');
const sourceEnv = { RELEASE_DATABASE_URL: env.DATABASE_URL };
for (const name of ['ENDPOINT', 'BUCKET', 'REGION', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY']) sourceEnv['RELEASE_S3_' + name] = env['ARTIFACT_S3_' + name];
const config = configuration(sourceEnv);
const sql = postgres(env.DATABASE_URL, { max: 2, idle_timeout: 1 });
const client = new S3Client({ endpoint: config.endpoint, region: config.region, forcePathStyle: true, credentials: config.credentials, requestChecksumCalculation: 'WHEN_REQUIRED' });
const hash = body => createHash('sha256').update(body).digest('hex');
const report = {};
const marker = 'release_proof_' + randomBytes(8).toString('hex');
let ownedApp;
async function stopApp() {
  const pid = ownedApp?.pid ?? Number(await readFile(path.join(run, 'app.pid'), 'utf8'));
  assert.equal(await readlink(`/proc/${pid}/cwd`), root);
  assert((await readFile(`/proc/${pid}/cmdline`, 'utf8')).includes('services/tools/.output/server/index.mjs'));
  process.kill(-pid, 'SIGTERM');
  for (let count = 0; count < 150; count++) {
    try { const value = await readFile(`/proc/${pid}/stat`, 'utf8'); if (value.split(') ')[1].startsWith('Z')) return; }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    await delay(100);
  }
  throw new Error('Owned app did not stop');
}
async function startApp() {
  const log = await import('node:fs').then(fs => fs.openSync(path.join(directory, 'app.log'), 'a', 0o600));
  ownedApp = spawn('node', ['services/tools/.output/server/index.mjs'], { cwd: root, detached: true,
    env: { ...env, PORT: '43173', HOST: '127.0.0.1', TMPDIR: tmpdir }, stdio: ['ignore', log, log] });
  await writeFile(path.join(run, 'app.pid'), String(ownedApp.pid));
  for (let count = 0; count < 600; count++) {
    assert.equal(ownedApp.exitCode, null, 'Owned app exited');
    try { if ((await fetch('http://127.0.0.1:43173/health')).ok) return; } catch {}
    await delay(100);
  }
  throw new Error('Owned app readiness failed');
}
async function request(route, method, body, json = true) {
  const response = await fetch('http://127.0.0.1:43173' + route, { method, headers: { Authorization: 'Bearer ' + env.UPLOAD_TOKEN,
    ...(body !== undefined ? { 'Content-Type': json ? 'application/json' : 'application/octet-stream' } : {}) },
    ...(body !== undefined ? { body: json ? JSON.stringify(body) : body } : {}) });
  assert(response.ok, `${method} ${route.split('/').slice(0,4).join('/')} returned ${response.status}`);
  return response.status === 204 ? undefined : response.json();
}
async function raw(key) {
  const result = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
  return Buffer.from(await result.Body.transformToByteArray());
}
async function capture(name) {
  const destination = path.join(directory, name);
  const result = await backup(config, [tmpdir], destination);
  await writeFile(path.join(directory, name + '.result.json'), JSON.stringify(result));
  return destination;
}
async function target() {
  const owner = randomBytes(12).toString('hex');
  const database = 'tools_release_restore_' + owner;
  const bucket = 'tools-release-restore-' + owner;
  await sql.unsafe(`create database "${database}"`);
  const url = new URL(config.databaseUrl); url.pathname = '/' + database;
  const targetSql = postgres(url.href, { max: 1 });
  try {
    await targetSql`create table public.tools_runtime_test_sentinel(sentinel_key text primary key, sentinel_value text not null)`;
    await targetSql`insert into public.tools_runtime_test_sentinel values ('database-purpose', 'tools-runtime-disposable-test-database'),
      ('release-restore-owner', ${owner}), ('release-restore-state', 'empty')`;
  } finally { await targetSql.end(); }
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  await client.send(new PutBucketTaggingCommand({ Bucket: bucket, Tagging: { TagSet: [
    { Key: 'tools-release-restore-owner', Value: owner }, { Key: 'tools-release-restore-state', Value: 'empty' }
  ] } }));
  const values = Object.fromEntries(Object.entries(sourceEnv).map(([name, value]) => [name.replace('RELEASE_', 'RELEASE_RESTORE_'), value]));
  Object.assign(values, { RELEASE_RESTORE_DATABASE_URL: url.href, RELEASE_RESTORE_S3_BUCKET: bucket, RELEASE_RESTORE_OWNER: owner });
  await writeFile(path.join(directory, 'target-' + owner + '.json'), JSON.stringify(values), { mode: 0o600 });
  return configuration(values, true);
}
try {
  const previousPid = Number(await readFile(path.join(run, 'app.pid'), 'utf8'));
  try { assert.equal(await readlink(`/proc/${previousPid}/cwd`), root); }
  catch (error) { if (error.code !== 'ENOENT') throw error; await startApp(); }
  const chunk = Buffer.alloc(1024 * 1024 + 9, 87);
  await writeFile(path.join(directory, 'legacy-source.bin'), chunk);
  const session = await request('/api/uploads/chunks', 'POST', { filename: 'legacy-source.bin', contentType: 'application/octet-stream',
    totalBytes: chunk.length, totalChunks: 2, chunkBytes: 1024 * 1024 });
  const chunkPath = '/api/uploads/chunks/' + session.sessionId;
  await request(chunkPath + '/0', 'PUT', chunk.subarray(0, 1024 * 1024), false);
  const before = await preflight(config, [tmpdir]);
  assert.equal(before.releaseReady, false);
  assert(before.legacy.some(item => item.kind === 'legacy-chunk-directory'));
  await cp(tmpdir, path.join(directory, 'legacy-recovery-evidence'), { recursive: true });
  await writeFile(path.join(directory, 'legacy-preflight-before.json'), JSON.stringify(before));
  await stopApp();
  await startApp();
  await request(chunkPath + '/1', 'PUT', chunk.subarray(1024 * 1024), false);
  const completed = await request(chunkPath + '/complete', 'POST');
  const [legacy] = await sql`select object_key, sha256 from artifacts.objects where id = ${completed.id}`;
  assert.equal(hash(await raw(legacy.object_key)), hash(chunk));
  assert.equal(legacy.sha256, hash(chunk));
  await stopApp();
  const drained = await preflight(config, [tmpdir]);
  assert.equal(drained.releaseReady, true);
  await writeFile(path.join(directory, 'legacy-preflight-after.json'), JSON.stringify(drained));
  report.legacyChunkDrainAcrossAppRestart = 'passed';
  await sql`create table tools.${sql(marker)}(id integer primary key, generation integer not null)`;
  await sql`insert into tools.${sql(marker)} values (1, 0)`;
  const metadataBody = Buffer.from('<h1>retained raw metadata body</h1>');
  const retainedKey = 'retained-proof/' + randomUUID();
  await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: retainedKey, Body: metadataBody,
    ContentType: 'text/html', CacheControl: 'private, no-store', ContentDisposition: 'inline; filename="retained.html"',
    ContentLanguage: 'en', Metadata: { fixture: 'paired-retained' }, Tagging: 'purpose=paired-proof&retained=true' }));
  const first = await capture('before-newer');
  await startApp();
  const newer = path.join(directory, 'newer.html');
  await writeFile(newer, '<!doctype html><title>Newer source</title><h1>Keep newer source commit</h1>');
  const output = execFileSync(root + '/services/tools/publisher/node_modules/.bin/tsx',
    ['services/tools/publisher/scripts/upload-direct.ts', newer, randomUUID()], { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const newerResult = JSON.parse(output.trim().split('\n').at(-1));
  await writeFile(path.join(directory, 'newer-result.json'), output);
  await stopApp();
  const second = await capture('after-newer');
  const restored = await target();
  report.pairedRestore = await restore(restored, first);
  report.restoredRepeatVerification = await verify(restored, first);
  await assert.rejects(() => restore(restored, first), /fresh owner|empty-state|fresh database|not empty/);
  await verify(restored, first);
  report.nonemptyTargetRefusedWithoutChanges = 'passed';
  report.newerSourceUnchanged = await verify(config, second, { source: true });
  await assert.rejects(() => verify(restored, first, { source: true }), /original database/);
  report.cloneCannotVerifySource = 'passed';
  const [newerRow] = await sql`select object_key, sha256 from artifacts.objects where id = ${newerResult.id}`;
  assert.equal(hash(await raw(newerRow.object_key)), hash(await readFile(newer)));
  report.newerSourceRawBytes = 'passed';
  const id = randomBytes(24).toString('base64url');
  const operation = randomUUID();
  const oldPayload = JSON.stringify({ id, kind: 'html', filename: 'retained.html', contentType: 'text/html',
    bytes: metadataBody.length, objectKey: retainedKey, sha256: hash(metadataBody), now: new Date().toISOString() });
  await sql`insert into artifacts.operations(operation_id, artifact_id, owner_id, lease_until, operation_kind, payload)
    values (${operation}::uuid, ${id}, 'paired-proof-fixture', now() + interval '1 day', 'put_html', ${sql.json(oldPayload)})`;
  assert.equal((await preflight(config, [tmpdir])).releaseReady, false);
  const journalBackup = await capture('historical-journal');
  const journalTarget = await target();
  report.historicalJournalAndReceipts = await restore(journalTarget, journalBackup);
  const journalSql = postgres(journalTarget.databaseUrl, { max: 1 });
  try {
    const [saved] = await journalSql`select payload from artifacts.operations where operation_id = ${operation}::uuid`;
    assert.equal(saved.payload, oldPayload);
    assert((await journalSql`select receipt from artifacts.upload_sessions where receipt is not null`).length > 0);
  } finally { await journalSql.end(); }
  const invalid = path.join(directory, 'concurrent-invalid');
  let writing = true;
  const writer = (async () => { while (writing) { await sql`update tools.${sql(marker)} set generation = generation + 1 where id = 1`; await delay(10); } })();
  try { await assert.rejects(() => backup(config, [tmpdir], invalid), /Concurrent database|WAL advanced/); }
  finally { writing = false; await writer; }
  await assert.rejects(() => readFile(path.join(invalid, 'COMPLETE')));
  report.concurrentWritesInvalidateBackup = 'passed';
  report.fixtureSourcesAndRecoveryEvidenceRetained = 'passed';
  await writeFile(path.join(directory, 'result.json'), JSON.stringify(report, null, 2));
  await writeFile(path.join(root, '.agents/artifacts/direct-upload-vm-20261016/paired-proof-result.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(path.join(fixture, 'latest-paired-run'), directory);
  console.log(JSON.stringify(report));
} finally { if (ownedApp?.exitCode === null) await stopApp(); await sql.end(); client.destroy(); }

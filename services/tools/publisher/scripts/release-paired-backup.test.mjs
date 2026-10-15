import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { configuration, legacyInventory, restore } from './release-paired-backup.mjs';

const script = fileURLToPath(new URL('./release-paired-backup.mjs', import.meta.url));
const artifactRoot = fileURLToPath(new URL('../../../../.agents/artifacts/direct-upload-release-proof-vm-20261016/', import.meta.url));
const env = { RELEASE_DATABASE_URL: 'postgres://fixture@127.0.0.1:5432/tools_runtime_test',
  RELEASE_S3_ENDPOINT: 'http://127.0.0.1:49000', RELEASE_S3_BUCKET: 'tools-transfer-test',
  RELEASE_S3_REGION: 'us-east-1', RELEASE_S3_ACCESS_KEY_ID: 'fixture', RELEASE_S3_SECRET_ACCESS_KEY: 'fixture' };

async function fixture(t) {
  await mkdir(artifactRoot, { recursive: true });
  const directory = await mkdtemp(path.join(artifactRoot, 'unit-'));
  t.after(() => rm(directory, { recursive: true }));
  return directory;
}

test('configuration rejects remote endpoints and URL options before connecting', () => {
  assert.equal(configuration(env).bucket, 'tools-transfer-test');
  for (const value of ['postgres://fixture@example.com/db', env.RELEASE_DATABASE_URL + '?host=example.com',
    'postgres://fixture@127.0.0.1/dbname%3Dhost%3Devil', 'postgres://fixture@localhost/db']) {
    assert.throws(() => configuration({ ...env, RELEASE_DATABASE_URL: value }));
  }
  for (const value of ['https://example.com', 'http://localhost:49000', 'http://127.0.0.1:49000?endpoint=evil']) {
    assert.throws(() => configuration({ ...env, RELEASE_S3_ENDPOINT: value }));
  }
  assert.throws(() => configuration({ ...env, RELEASE_S3_BUCKET: 'production' }));
});

test('restore requires a matching explicit owner in its bucket name', () => {
  const restoreEnv = Object.fromEntries(Object.entries(env).map(([key, value]) => [key.replace('RELEASE_', 'RELEASE_RESTORE_'), value]));
  restoreEnv.RELEASE_RESTORE_OWNER = 'a123456789abcdef';
  assert.throws(() => configuration(restoreEnv, true));
  restoreEnv.RELEASE_RESTORE_S3_BUCKET = 'tools-release-restore-a123456789abcdef';
  assert.equal(configuration(restoreEnv, true).owner, 'a123456789abcdef');
});

test('expired chunks, staged files, unknown paths, and malformed manifests all remain blockers', async t => {
  const directory = await fixture(t);
  const chunks = 'artifact-chunks-' + 'a'.repeat(32);
  await mkdir(path.join(directory, chunks));
  const manifest = JSON.stringify({ version: 1, audience: 'native', originalName: 'old.bin',
    contentType: 'application/octet-stream', totalBytes: 3, totalChunks: 1, chunkBytes: 1048576,
    createdAt: '2000-01-01T00:00:00Z' });
  await writeFile(path.join(directory, chunks, 'manifest.json'), manifest);
  await writeFile(path.join(directory, chunks, '0.part'), 'old');
  await writeFile(path.join(directory, 'artifact-publisher-' + 'b'.repeat(32)), 'staged');
  await mkdir(path.join(directory, 'artifact-chunks-malformed'));
  await mkdir(path.join(directory, 'artifact-unknown'));
  await symlink(chunks, path.join(directory, 'artifact-chunks-' + 'c'.repeat(32)));
  const inventory = await legacyInventory([directory]);
  assert.equal(inventory.length, 5);
  assert.equal(inventory.find(entry => entry.name === chunks).kind, 'legacy-chunk-directory');
  assert.equal(inventory.filter(entry => entry.kind === 'unknown').length, 3);
  assert.equal(inventory.filter(entry => entry.kind === 'staged-file').length, 1);
  assert.equal(await readFile(path.join(directory, chunks, 'manifest.json'), 'utf8'), manifest);
  assert.equal(await readFile(path.join(directory, chunks, '0.part'), 'utf8'), 'old');
  await writeFile(path.join(directory, chunks, 'manifest.json'), '{broken');
  const malformed = await legacyInventory([directory]);
  assert.equal(malformed.find(entry => entry.name === chunks).kind, 'malformed-chunk-directory');
  assert.equal((await readdir(directory)).length, 5);
});

test('missing temporary roots fail closed and unrelated files do not block', async t => {
  const directory = await fixture(t);
  await writeFile(path.join(directory, 'unrelated'), 'keep');
  assert.deepEqual(await legacyInventory([directory]), []);
  await assert.rejects(() => legacyInventory([]));
  await assert.rejects(() => legacyInventory([path.join(directory, 'missing')]));
  await symlink(directory, path.join(directory, 'linked-root'));
  await assert.rejects(() => legacyInventory([path.join(directory, 'linked-root')]));
});

test('a corrupt backup is rejected before any target connection or write', async t => {
  const directory = await fixture(t);
  await writeFile(path.join(directory, 'manifest.json'), '{"format":1}\n');
  await writeFile(path.join(directory, 'COMPLETE'), 'wrong\n');
  await assert.rejects(() => restore({}, directory), /Invalid backup completion digest/);
  assert.deepEqual((await readdir(directory)).sort(), ['COMPLETE', 'manifest.json']);
});

test('restore rejects altered body bytes before connecting to the target', async t => {
  const directory = await fixture(t);
  const hash = value => createHash('sha256').update(value).digest('hex');
  const database = JSON.stringify({ 'artifacts.objects': [], 'artifacts.operations': [],
    'artifacts.upload_sessions': [], 'artifacts.upload_links': [] });
  const dump = 'fake dump, never restored';
  const key = 'transfers/retained-version';
  const file = `bodies/${hash(key)}.bin`;
  await mkdir(path.join(directory, 'bodies'));
  await writeFile(path.join(directory, file), 'changed body');
  await writeFile(path.join(directory, 'database.json'), database);
  await writeFile(path.join(directory, 'database.dump'), dump);
  const manifest = JSON.stringify({ format: 1, databaseSha256: hash(database),
    dump: { bytes: Buffer.byteLength(dump), sha256: hash(dump) },
    objects: [{ key, file, bytes: 8, sha256: hash('original'), metadata: {}, tags: [] }] });
  await writeFile(path.join(directory, 'manifest.json'), manifest);
  await writeFile(path.join(directory, 'COMPLETE'), hash(manifest) + '\n');
  await assert.rejects(() => restore({}, directory), /The backup body changed/);
  assert.equal(await readFile(path.join(directory, file), 'utf8'), 'changed body');
});

test('the callable CLI documents commands and rejects unknown flags', () => {
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(help.status, 0, help.stderr);
  for (const command of ['preflight', 'backup', 'restore', 'verify']) assert(help.stdout.includes(command));
  const invalid = spawnSync(process.execPath, [script, 'restore', '--clean'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Unknown option/);
});

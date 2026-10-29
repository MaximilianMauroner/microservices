import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { rootCertificates } from 'node:tls';
import { configuration, legacyInventory, preflight, references, requireSourceIdentity, restore } from './release-paired-backup.mjs';

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

function retainedReplacement() {
  const id = 'a'.repeat(32);
  const objects = ['A', 'B', 'C'].map(version => ({ key: `versions/${version}`,
    bytes: Buffer.byteLength(`body ${version}`), sha256: createHash('sha256').update(`body ${version}`).digest('hex') }));
  const [before, after, current] = objects.map(body => ({ id, object_key: body.key,
    bytes: String(body.bytes), sha256: body.sha256, revoked_at: null }));
  const state = { 'artifacts.objects': [JSON.stringify({ ...current, bytes: Number(current.bytes) })],
    'artifacts.upload_sessions': [JSON.stringify({ target_id: id, receipt: { format: 1, before, after } })],
    'artifacts.operations': [] };
  return { state, objects };
}

test('retained replacement snapshots accept string byte counts after the canonical body advances', () => {
  const { state, objects } = retainedReplacement();
  assert.doesNotThrow(() => references(state, objects));
});

for (const side of ['before', 'after']) {
  for (const failure of ['missing', 'size', 'digest']) {
    test(`retained replacement ${side} body rejects ${failure} with a newer canonical body`, () => {
      const { state, objects } = retainedReplacement();
      const session = JSON.parse(state['artifacts.upload_sessions'][0]);
      const body = objects.find(object => object.key === session.receipt[side].object_key);
      if (failure === 'missing') objects.splice(objects.indexOf(body), 1);
      if (failure === 'size') body.bytes += 1;
      if (failure === 'digest') body.sha256 = '0'.repeat(64);
      assert.throws(() => references(state, objects), /retained replacement body/);
    });
  }
}

for (const invalid of ['format', 'before', 'after']) {
  test(`retained replacement receipts reject an invalid ${invalid}`, () => {
    const { state, objects } = retainedReplacement();
    const session = JSON.parse(state['artifacts.upload_sessions'][0]);
    if (invalid === 'format') session.receipt.format = 2;
    else session.receipt[invalid].id = 'b'.repeat(32);
    state['artifacts.upload_sessions'][0] = JSON.stringify(session);
    assert.throws(() => references(state, objects), /Invalid retained replacement receipt/);
  });
}

test('a retained old body with a null digest still requires its recorded size', () => {
  const { state, objects } = retainedReplacement();
  const session = JSON.parse(state['artifacts.upload_sessions'][0]);
  session.receipt.before.sha256 = null;
  state['artifacts.upload_sessions'][0] = JSON.stringify(session);
  assert.doesNotThrow(() => references(state, objects));
  objects[0].bytes += 1;
  assert.throws(() => references(state, objects), /retained replacement body/);
});

test('revoked replacement targets do not require deleted canonical or retained bodies', () => {
  const { state } = retainedReplacement();
  const current = JSON.parse(state['artifacts.objects'][0]);
  current.revoked_at = '2026-10-16T12:00:00.000Z';
  state['artifacts.objects'][0] = JSON.stringify(current);
  assert.doesNotThrow(() => references(state, []));
});

test('a pending journal can precede its body write when the live base is present', () => {
  const { state, objects } = retainedReplacement();
  state['artifacts.operations'].push(JSON.stringify({ artifact_id: 'a'.repeat(32),
    payload: { expectedObjectKey: 'versions/C', objectKey: 'versions/pending' } }));
  assert.doesNotThrow(() => references(state, objects));
});

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

test('production source access is explicit, scoped and cannot restore', async t => {
  const certificate = path.join(await fixture(t), 'root.pem');
  await writeFile(certificate, rootCertificates[0]);
  const production = { ...env, RELEASE_DATABASE_URL: 'postgres://fixture@db.example.test/tools?sslmode=verify-full',
    RELEASE_S3_ENDPOINT: 'https://storage.example.test', RELEASE_S3_BUCKET: 'owned-production-bucket',
    RELEASE_S3_FORCE_PATH_STYLE: 'false', RELEASE_DATABASE_SSL_ROOT_CERT: certificate, ...Object.fromEntries(
      ['PROJECT_ID', 'ENVIRONMENT_ID', 'SERVICE_ID', 'BUCKET_RESOURCE_ID'].map(name => ['RELEASE_SOURCE_' + name, '12345678-1234-1234-1234-123456789abc'])) };
  assert.throws(() => configuration(production));
  const config = configuration(production, false, true);
  assert.equal(config.productionSource, true);
  assert.equal(config.forcePathStyle, false);
  assert.equal(config.databaseSslMode, 'verify-full');
  assert.equal(config.onSourceHost, false);
  const onRailway = { ...production, ...Object.fromEntries(['PROJECT_ID', 'ENVIRONMENT_ID', 'SERVICE_ID']
    .map(name => ['RAILWAY_' + name, production['RELEASE_SOURCE_' + name]])) };
  assert.equal(configuration(onRailway, false, true).onSourceHost, false);
  assert.equal(configuration({ ...onRailway, RAILWAY_DEPLOYMENT_ID: 'owned-deployment', RAILWAY_REPLICA_ID: 'owned-replica' }, false, true).onSourceHost, true);
  assert.throws(() => configuration({ ...production, RELEASE_DATABASE_URL: production.RELEASE_DATABASE_URL.replace('verify-full', 'require') }, false, true));
  assert.throws(() => configuration(production, true, true));
  assert.throws(() => configuration({ ...production, RELEASE_SOURCE_PROJECT_ID: '' }, false, true));
  assert.throws(() => configuration({ ...production, RELEASE_DATABASE_URL: production.RELEASE_DATABASE_URL + '&host=other' }, false, true));
  assert.throws(() => configuration({ ...production, RELEASE_S3_ENDPOINT: 'http://storage.example.test' }, false, true));
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
  assert(help.stdout.includes('services/tools/publisher/direct-transfers.md'));
  const invalid = spawnSync(process.execPath, [script, 'restore', '--clean'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Unknown option/);
});


test('source verification rejects a matching clone under another connection or scope', () => {
  const config = configuration(env);
  const source = { endpoint: config.endpoint, bucket: config.bucket, database: 'tools_runtime_test',
    databaseHost: '127.0.0.1', databasePort: '5432' };
  requireSourceIdentity(config, source);
  for (const change of [{ bucket: 'tools-release-other' }, { endpoint: 'http://127.0.0.1:49010' },
    { databaseUrl: 'postgres://fixture@127.0.0.1:5433/tools_runtime_test' },
    { databaseUrl: 'postgres://fixture@127.0.0.1:5432/other_database' },
    { sourceScope: { PROJECT_ID: 'different' } }]) {
    assert.throws(() => requireSourceIdentity({ ...config, ...change }, source), /original database/);
  }
});


test('production legacy drain refuses a different execution host before connecting', async () => {
  await assert.rejects(() => preflight({ productionSource: true, onSourceHost: false }, []), /inside the exact Railway/);
});

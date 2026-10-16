import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, readFileSync } from 'node:fs';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { hostname } from 'node:os';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import postgres from 'postgres';
import {
  GetBucketTaggingCommand, GetBucketVersioningCommand, GetObjectCommand, GetObjectTaggingCommand,
  ListMultipartUploadsCommand, ListObjectsV2Command, PutBucketTaggingCommand, PutObjectCommand, S3Client
} from '@aws-sdk/client-s3';

const sentinelValue = 'tools-runtime-disposable-test-database';
const metadataFields = ['ContentType', 'CacheControl', 'ContentDisposition', 'ContentEncoding',
  'ContentLanguage', 'Expires', 'WebsiteRedirectLocation', 'Metadata', 'ServerSideEncryption'];
const digest = value => createHash('sha256').update(value).digest('hex');
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const json = value => JSON.stringify(value, null, 2) + '\n';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    if (value instanceof Date) return value.toISOString();
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function equal(actual, expected, message) {
  assert.equal(JSON.stringify(canonical(actual)), JSON.stringify(canonical(expected)), message);
}

function required(env, name) {
  assert(env[name], `Set ${name}`);
  return env[name];
}

export function configuration(env, restore = false, productionSource = false) {
  assert(!restore || !productionSource, 'Production is never a restore target');
  const prefix = restore ? 'RELEASE_RESTORE_' : 'RELEASE_';
  const databaseUrl = required(env, prefix + 'DATABASE_URL');
  const endpoint = required(env, prefix + 'S3_ENDPOINT');
  for (const [value, protocols] of [[databaseUrl, ['postgres:', 'postgresql:']], [endpoint, ['http:', 'https:']]]) {
    const url = new URL(value);
    assert(protocols.includes(url.protocol) && (productionSource || ['127.0.0.1', '[::1]'].includes(url.hostname)),
      'Release fixtures require literal loopback addresses');
    assert(!url.hash && (!url.search || productionSource && value === databaseUrl
      && [...url.searchParams.keys()].every(key => key === 'sslmode')), 'Connection URL options are forbidden');
    if (value === endpoint) assert(!url.username && !url.password && url.pathname === '/', 'Use a bare S3 endpoint');
    else assert(/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(decodeURIComponent(url.pathname.slice(1))), 'Use a plain owned database name');
  }
  const bucket = required(env, prefix + 'S3_BUCKET');
  assert(productionSource || /^tools-(transfer-test|release-[a-z0-9-]+)$/.test(bucket), 'Use an owned Tools fixture bucket');
  let sourceScope;
  let forcePathStyle = true;
  let databaseSslMode = 'disable';
  let databaseCaPath;
  let databaseCa;
  let onSourceHost = false;
  let sourceInstance;
  if (productionSource) {
    assert(new URL(endpoint).protocol === 'https:', 'Production S3 reads require HTTPS');
    sourceScope = Object.fromEntries(['PROJECT_ID', 'ENVIRONMENT_ID', 'SERVICE_ID', 'BUCKET_RESOURCE_ID'].map(name => {
      const value = required(env, 'RELEASE_SOURCE_' + name);
      assert(/^[0-9a-f-]{36}$/.test(value), 'Production source resource IDs are required');
      return [name, value];
    }));
    const style = required(env, 'RELEASE_S3_FORCE_PATH_STYLE');
    assert(['true', 'false'].includes(style), 'Copy the configured S3 addressing style');
    forcePathStyle = style === 'true';
    databaseSslMode = new URL(databaseUrl).searchParams.get('sslmode') || 'verify-full';
    assert.equal(databaseSslMode, 'verify-full', 'Production database reads require verified TLS');
    databaseCaPath = path.resolve(required(env, 'RELEASE_DATABASE_SSL_ROOT_CERT'));
    databaseCa = readFileSync(databaseCaPath, 'utf8');
    assert(databaseCa.includes('-----BEGIN CERTIFICATE-----'), 'Use a PEM certificate authority file');
    onSourceHost = ['PROJECT_ID', 'ENVIRONMENT_ID', 'SERVICE_ID'].every(name => env['RAILWAY_' + name] === sourceScope[name])
      && Boolean(env.RAILWAY_DEPLOYMENT_ID && env.RAILWAY_REPLICA_ID);
    sourceInstance = { hostname: hostname(), deploymentId: env.RAILWAY_DEPLOYMENT_ID, replicaId: env.RAILWAY_REPLICA_ID };
  }
  const owner = restore ? required(env, prefix + 'OWNER') : undefined;
  if (restore) {
    assert(/^[a-z0-9]{16,40}$/.test(owner), 'Restore owner must be 16 to 40 lowercase letters or digits');
    assert.equal(bucket, `tools-release-restore-${owner}`, 'Restore bucket name must contain its owner');
  }
  return { databaseUrl, endpoint, bucket, owner, productionSource, sourceScope, forcePathStyle, databaseSslMode, databaseCaPath, databaseCa, onSourceHost, sourceInstance,
    region: required(env, prefix + 'S3_REGION'),
    credentials: { accessKeyId: required(env, prefix + 'S3_ACCESS_KEY_ID'),
      secretAccessKey: required(env, prefix + 'S3_SECRET_ACCESS_KEY') } };
}

function connections(config, readOnly = true) {
  return {
    sql: postgres(config.databaseUrl, { max: 1, connect_timeout: 10, idle_timeout: 5,
      ...(config.productionSource ? { ssl: { ca: config.databaseCa, rejectUnauthorized: true } } : {}),
      connection: { timezone: 'UTC', application_name: 'tools-release-proof',
        default_transaction_read_only: readOnly ? 'on' : 'off', statement_timeout: 120000 } }),
    client: new S3Client({ endpoint: config.endpoint, region: config.region, forcePathStyle: config.forcePathStyle,
      credentials: config.credentials, maxAttempts: 1, requestChecksumCalculation: 'WHEN_REQUIRED' })
  };
}

async function sentinel(sql) {
  const rows = await sql`select c.relkind::text kind, s.sentinel_value value
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join public.tools_runtime_test_sentinel s
    where n.nspname = 'public' and c.relname = 'tools_runtime_test_sentinel'
      and s.sentinel_key = 'database-purpose'`;
  assert(rows.length === 1 && rows[0].kind === 'r' && rows[0].value === sentinelValue,
    'The owned disposable database sentinel is required');
}

async function databaseState(sql) {
  const tables = await sql`select n.nspname as schema, c.relname as name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('tools', 'artifacts') and c.relkind in ('r', 'p')
    order by n.nspname collate "C", c.relname collate "C"`;
  const state = {};
  for (const table of tables) {
    const name = `${quote(table.schema)}.${quote(table.name)}`;
    const rows = await sql.unsafe(`select to_jsonb(t)::text as value from ${name} t order by to_jsonb(t)::text collate "C"`);
    state[`${table.schema}.${table.name}`] = rows.map(row => row.value);
  }
  for (const name of ['artifacts.objects', 'artifacts.operations', 'artifacts.upload_sessions', 'artifacts.upload_links']) {
    assert(Array.isArray(state[name]), `Required table is absent: ${name}`);
  }
  return state;
}

function pending(state) {
  const canonicalIds = new Set(state['artifacts.objects'].map(raw => JSON.parse(raw).id));
  const retainedRecoveryEvidence = state['artifacts.operations'].map(raw => JSON.parse(raw)).filter(row => {
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    return payload && !payload.expectedObjectKey && !canonicalIds.has(row.artifact_id)
      && !['pages/' + row.artifact_id + '.html', 'files/' + row.artifact_id].includes(payload.objectKey);
  }).length;
  const sessions = state['artifacts.upload_sessions'].map(row => JSON.parse(row));
  return { operations: state['artifacts.operations'].length, retainedRecoveryEvidence,
    activeSessions: sessions.filter(row => ['creating', 'uploading', 'completing'].includes(row.state)).length };
}

export async function legacyInventory(directories) {
  assert(directories.length, 'Pass --tmpdir for every Tools process temporary directory');
  const inventory = [];
  for (const directory of directories) {
    assert((await lstat(directory)).isDirectory(), 'The temporary path must be a real directory');
    const root = await realpath(directory);
    for (const name of (await readdir(root)).sort()) {
      if (!name.startsWith('artifact-')) continue;
      const fullPath = path.join(root, name);
      const stat = await lstat(fullPath);
      const entry = { root, name, bytes: stat.size, modified: stat.mtime.toISOString(), kind: 'unknown' };
      if (/^artifact-publisher-[0-9a-f]{32}$/.test(name) && stat.isFile()) entry.kind = 'staged-file';
      if (/^artifact-chunks-[A-Za-z0-9_-]{32}$/.test(name) && stat.isDirectory()) {
        entry.kind = 'malformed-chunk-directory';
        entry.files = [];
        for (const child of (await readdir(fullPath)).sort()) {
          const info = await lstat(path.join(fullPath, child));
          entry.files.push({ name: child, regular: info.isFile(), bytes: info.size, modified: info.mtime.toISOString() });
        }
        const file = entry.files.find(child => child.name === 'manifest.json' && child.regular && child.bytes < 65536);
        if (file) {
          try {
            const raw = await readFile(path.join(fullPath, 'manifest.json'), 'utf8');
            entry.manifestSha256 = digest(raw);
            const value = JSON.parse(raw);
            const valid = value?.version === 1 && ['browser', 'native', 'drop'].includes(value.audience)
              && (value.audience !== 'drop' || /^[0-9a-f-]{36}$/i.test(value.uploadLinkId ?? ''))
              && typeof value.originalName === 'string' && typeof value.contentType === 'string'
              && Number.isSafeInteger(value.totalBytes) && value.totalBytes > 0
              && Number.isSafeInteger(value.totalChunks) && value.totalChunks > 0 && value.totalChunks <= 250
              && Number.isSafeInteger(value.chunkBytes) && value.chunkBytes > 0
              && Math.ceil(value.totalBytes / value.chunkBytes) === value.totalChunks
              && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt))
              && entry.files.every(child => child.regular && (child.name === 'manifest.json'
                || /^(0|[1-9][0-9]*)\.part$/.test(child.name) && Number(child.name.split('.')[0]) < value.totalChunks));
            if (valid) entry.kind = 'legacy-chunk-directory';
          } catch (error) {
            if (!(error instanceof SyntaxError)) throw error;
          }
        }
      }
      inventory.push(entry);
    }
  }
  return inventory;
}

async function bucketInventory(client, bucket) {
  const versioning = await client.send(new GetBucketVersioningCommand({ Bucket: bucket }));
  assert(!versioning.Status, 'Versioned or suspended buckets need a version-aware exporter');
  const objects = [];
  let token;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
    for (const item of page.Contents ?? []) {
      assert(typeof item.Key === 'string' && Number.isSafeInteger(item.Size) && item.ETag && item.LastModified,
        'Incomplete bucket listing');
      objects.push({ key: item.Key, bytes: item.Size, etag: item.ETag, modified: item.LastModified.toISOString() });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
    assert(!page.IsTruncated || token, 'Incomplete bucket pagination');
  } while (token);
  const multipart = await client.send(new ListMultipartUploadsCommand({ Bucket: bucket, MaxUploads: 1 }));
  assert(!multipart.IsTruncated && !multipart.Uploads?.length, 'Pending bucket multipart uploads block the paired backup');
  objects.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  assert(new Set(objects.map(item => item.key)).size === objects.length, 'Duplicate bucket listing keys');
  return objects;
}

function objectMetadata(result) {
  assert(!result.ServerSideEncryption || result.ServerSideEncryption === 'AES256', 'KMS or customer encryption requires a separate recovery procedure');
  assert(!result.ObjectLockMode && !result.ObjectLockRetainUntilDate && !result.ObjectLockLegalHoldStatus,
    'Object lock requires a separate recovery procedure');
  assert(!result.StorageClass || result.StorageClass === 'STANDARD', 'Non-standard storage classes require a separate recovery procedure');
  return canonical(Object.fromEntries(metadataFields.filter(field => result[field] !== undefined).map(field => [field, result[field]])));
}

async function hashStream(stream, destination) {
  let bytes = 0;
  const hash = createHash('sha256');
  if (destination) {
    const counter = new Transform({ transform(chunk, encoding, done) { bytes += chunk.length; hash.update(chunk); done(null, chunk); } });
    await pipeline(stream, counter, createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
  } else {
    for await (const chunk of stream) { bytes += chunk.length; hash.update(chunk); }
  }
  return { bytes, sha256: hash.digest('hex') };
}

async function bucketBodies(client, bucket, inventory, directory) {
  const records = [];
  for (const item of inventory) {
    const file = `bodies/${digest(item.key)}.bin`;
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: item.key, IfMatch: item.etag }));
    assert(result.Body, 'Bucket object has no body');
    let metadata;
    let hash;
    try {
      metadata = objectMetadata(result);
      equal({ bytes: result.ContentLength, etag: result.ETag, modified: result.LastModified?.toISOString() },
        { bytes: item.bytes, etag: item.etag, modified: new Date(Math.floor(Date.parse(item.modified) / 1000) * 1000).toISOString() },
        'The object changed after its inventory');
      hash = await hashStream(result.Body, directory && path.join(directory, file));
    } finally { result.Body.destroy(); }
    assert.equal(hash.bytes, item.bytes, 'Incomplete object read');
    const tags = await client.send(new GetObjectTaggingCommand({ Bucket: bucket, Key: item.key }));
    const tagSet = (tags.TagSet ?? []).sort((a, b) => a.Key < b.Key ? -1 : a.Key > b.Key ? 1 : 0);
    records.push({ ...item, ...hash, file, metadata, tags: tagSet });
  }
  return records;
}

async function pgCommand(command, args, config) {
  const url = new URL(config.databaseUrl);
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C',
    PGHOST: url.hostname === '[::1]' ? '::1' : url.hostname, PGPORT: url.port || '5432',
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password), PGPASSFILE: '/dev/null', PGSSLMODE: config.databaseSslMode,
    ...(config.databaseCaPath ? { PGSSLROOTCERT: config.databaseCaPath } : {}), PGCONNECT_TIMEOUT: '10',
    PGOPTIONS: '-c timezone=UTC -c statement_timeout=120000' };
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code}): ${stderr}`)));
  });
}

async function writeJson(file, value) {
  const raw = json(value);
  await writeFile(file, raw, { flag: 'wx', mode: 0o600 });
  return digest(raw);
}

function references(state, objects) {
  const bodies = new Map(objects.map(object => [object.key, object]));
  for (const raw of state['artifacts.objects']) {
    const row = JSON.parse(raw);
    if (row.revoked_at) continue;
    const body = bodies.get(row.object_key);
    assert(body && body.bytes === row.bytes && (!row.sha256 || body.sha256 === row.sha256),
      'A canonical object body is missing or has the wrong digest');
  }
}

function sourceIdentity(config) {
  const database = new URL(config.databaseUrl);
  return { endpoint: config.endpoint, bucket: config.bucket,
    database: decodeURIComponent(database.pathname.slice(1)), databaseHost: database.hostname,
    databasePort: database.port || '5432', ...(config.sourceScope ? { scope: config.sourceScope } : {}) };
}

export function requireSourceIdentity(config, source) {
  equal(sourceIdentity(config), source, 'Source verification must use the original database, bucket, and resource scope');
}

function requireSourceHost(config) {
  assert(!config.productionSource || config.onSourceHost,
    'Production legacy inventory must run inside the exact Railway project, environment, and service');
}

function stableDatabase(state, config) {
  return config.productionSource ? Object.fromEntries(Object.entries(state).filter(([name]) => name.startsWith('artifacts.'))) : state;
}

export async function preflight(config, directories) {
  requireSourceHost(config);
  const { sql, client } = connections(config);
  try {
    if (!config.productionSource) await sentinel(sql);
    const legacy = await legacyInventory(directories);
    const state = await sql.begin('isolation level repeatable read read only', databaseState);
    const status = pending(state);
    await bucketInventory(client, config.bucket);
    const report = { format: 1, ...(config.sourceInstance ? { sourceInstance: config.sourceInstance } : {}), releaseReady: !legacy.length && !status.operations && !status.activeSessions,
      legacy, ...status };
    return report;
  } finally { await sql.end(); client.destroy(); }
}

export async function backup(config, directories, directory) {
  requireSourceHost(config);
  const startedAt = new Date().toISOString();
  const { sql, client } = connections(config);
  try {
    if (!config.productionSource) await sentinel(sql);
    await mkdir(directory, { mode: 0o700 });
    await mkdir(path.join(directory, 'bodies'), { mode: 0o700 });
    const legacyBefore = await legacyInventory(directories);
    assert(!legacyBefore.length, 'Legacy temporary files block a paired backup');
    const manifest = await sql.begin('isolation level repeatable read read only', async tx => {
      const [{ snapshot }] = await tx`select pg_export_snapshot() as snapshot`;
      const database = await databaseState(tx);
      assert(!pending(database).activeSessions, 'Active direct sessions block a paired backup');
      const before = await bucketInventory(client, config.bucket);
      const bucketBeforeSha256 = await writeJson(path.join(directory, 'bucket-before.json'), before);
      const databaseSha256 = await writeJson(path.join(directory, 'database.json'), database);
      const dump = path.join(directory, 'database.dump');
      await pgCommand('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--schema=tools', '--schema=artifacts',
        '--snapshot=' + snapshot, '--file=' + dump], config);
      const dumpHash = await hashStream(createReadStream(dump));
      const objects = await bucketBodies(client, config.bucket, before, directory);
      const after = await bucketInventory(client, config.bucket);
      const bucketAfterSha256 = await writeJson(path.join(directory, 'bucket-after.json'), after);
      equal(after, before, 'Concurrent bucket writes or cleanup invalidated the backup');
      const checked = await bucketBodies(client, config.bucket, after);
      equal(checked, objects, 'Bucket body bytes, metadata, or tags changed during the backup');
      equal(await bucketInventory(client, config.bucket), before, 'The bucket changed during verification');
      references(database, objects);
      return { format: 1, source: sourceIdentity(config),
        ...(config.sourceInstance ? { sourceInstance: config.sourceInstance } : {}),
        consistency: { requiresQuiescentSource: true, bucketObservation: "two-full-reads", atomicBucketSnapshot: false },
        databaseSha256, bucketBeforeSha256, bucketAfterSha256, dump: dumpHash, objects, status: pending(database),
        snapshot, startedAt, temporaryDirectories: directories, legacy: legacyBefore };
    });
    const databaseAfter = await sql.begin('isolation level repeatable read read only', databaseState);
    const databaseBefore = JSON.parse(await readFile(path.join(directory, 'database.json'), 'utf8'));
    manifest.databaseAfterSha256 = await writeJson(path.join(directory, 'database-after.json'), databaseAfter);
    equal(stableDatabase(databaseAfter, config), stableDatabase(databaseBefore, config), 'Concurrent database writes or cleanup invalidated the backup');
    equal(await legacyInventory(directories), legacyBefore, 'Legacy temporary files appeared during the backup');
    manifest.completedAt = new Date().toISOString();
    const manifestSha256 = await writeJson(path.join(directory, 'manifest.json'), manifest);
    await writeFile(path.join(directory, 'COMPLETE'), manifestSha256 + '\n', { flag: 'wx', mode: 0o600 });
    return { complete: true, objects: manifest.objects.length, ...manifest.status, manifestSha256 };
  } finally { await sql.end(); client.destroy(); }
}

async function loadBackup(directory) {
  const raw = await readFile(path.join(directory, 'manifest.json'), 'utf8');
  assert.equal((await readFile(path.join(directory, 'COMPLETE'), 'utf8')).trim(), digest(raw), 'Invalid backup completion digest');
  const manifest = JSON.parse(raw);
  assert.equal(manifest.format, 1, 'Unsupported backup format');
  const databaseRaw = await readFile(path.join(directory, 'database.json'), 'utf8');
  assert.equal(digest(databaseRaw), manifest.databaseSha256, 'The database manifest changed');
  const database = JSON.parse(databaseRaw);
  equal(await hashStream(createReadStream(path.join(directory, 'database.dump'))), manifest.dump, 'The PostgreSQL dump changed');
  assert(Array.isArray(manifest.objects), 'Invalid object manifest');
  assert.equal(new Set(manifest.objects.map(object => object.key)).size, manifest.objects.length, 'Duplicate backup object keys');
  for (const object of manifest.objects) {
    assert(typeof object.key === 'string' && object.key.length > 0, 'Invalid backup object key');
    assert(object.metadata && Object.keys(object.metadata).every(key => metadataFields.includes(key)), 'Unknown object metadata field');
    assert.equal(object.file, `bodies/${digest(object.key)}.bin`, 'Invalid backup body path');
    const file = path.join(directory, object.file);
    assert((await lstat(file)).isFile(), 'The backup body must be a regular file');
    equal(await hashStream(createReadStream(file)), { bytes: object.bytes, sha256: object.sha256 }, 'The backup body changed');
  }
  references(database, manifest.objects);
  return { manifest, database };
}

async function emptyRestoreTarget(sql, client, config, manifest) {
  assert.notEqual(config.bucket, manifest.source.bucket, 'The restore bucket must have a separate name');
  assert.notEqual(decodeURIComponent(new URL(config.databaseUrl).pathname.slice(1)), manifest.source.database,
    'The restore database must have a separate name');
  await sentinel(sql);
  const markers = await sql`select sentinel_key, sentinel_value from public.tools_runtime_test_sentinel
    where sentinel_key in ('release-restore-owner', 'release-restore-state')`;
  const marker = Object.fromEntries(markers.map(row => [row.sentinel_key, row.sentinel_value]));
  assert(marker['release-restore-owner'] === config.owner && marker['release-restore-state'] === 'empty',
    'Restore requires fresh owner and empty-state sentinel rows');
  const schemas = await sql`select nspname from pg_namespace
    where nspname not in ('public', 'information_schema') and nspname not like 'pg_%'`;
  assert.equal(schemas.length, 0, 'Restore requires a fresh database with no product schemas');
  const relations = await sql`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
      and c.relname <> 'tools_runtime_test_sentinel'`;
  assert.equal(relations.length, 0, 'Restore requires an empty database apart from the sentinel');
  equal(await bucketInventory(client, config.bucket), [], 'The restore bucket is not empty');
  const tags = await client.send(new GetBucketTaggingCommand({ Bucket: config.bucket }));
  const tagMap = Object.fromEntries((tags.TagSet ?? []).map(tag => [tag.Key, tag.Value]));
  assert(tagMap['tools-release-restore-owner'] === config.owner && tagMap['tools-release-restore-state'] === 'empty',
    'The isolated bucket needs matching owner and empty-state tags');
  const claimed = await sql`update public.tools_runtime_test_sentinel set sentinel_value = 'restoring'
    where sentinel_key = 'release-restore-state' and sentinel_value = 'empty' returning sentinel_key`;
  assert.equal(claimed.length, 1, 'Another restore claimed this database');
  await client.send(new PutBucketTaggingCommand({ Bucket: config.bucket, Tagging: { TagSet: [
    { Key: 'tools-release-restore-owner', Value: config.owner }, { Key: 'tools-release-restore-state', Value: 'restoring' }
  ] } }));
}

function restoredObject(object) {
  return { key: object.key, bytes: object.bytes, sha256: object.sha256, metadata: object.metadata, tags: object.tags };
}

async function verifyRestored(sql, client, config, stored, source = false) {
  const scope = state => source ? stableDatabase(state, config) : state;
  const database = async () => scope(await sql.begin('isolation level repeatable read read only', databaseState));
  equal(await database(), scope(stored.database), 'The restored canonical rows, journal, sessions, or receipts differ');
  const inventory = await bucketInventory(client, config.bucket);
  const objects = await bucketBodies(client, config.bucket, inventory);
  equal(objects.map(restoredObject), stored.manifest.objects.map(restoredObject), 'Restored raw bodies or metadata differ');
  equal(await bucketInventory(client, config.bucket), inventory, 'The bucket changed during verification');
  equal(await database(), scope(stored.database), 'The database changed during verification');
  return { verified: true, objects: objects.length, databaseSha256: stored.manifest.databaseSha256 };
}

export async function restore(config, directory) {
  assert(!config.productionSource, 'Production is never a restore target');
  const stored = await loadBackup(directory);
  const { sql, client } = connections(config, false);
  try {
    await emptyRestoreTarget(sql, client, config, stored.manifest);
    await pgCommand('pg_restore', ['--exit-on-error', '--single-transaction', '--no-owner', '--no-acl',
      '--dbname=' + decodeURIComponent(new URL(config.databaseUrl).pathname.slice(1)), path.join(directory, 'database.dump')], config);
    for (const object of stored.manifest.objects) {
      const metadata = { ...object.metadata };
      if (metadata.Expires) metadata.Expires = new Date(metadata.Expires);
      const body = createReadStream(path.join(directory, object.file));
      try {
        await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: object.key, ...metadata,
          ContentLength: object.bytes, Body: body, IfNoneMatch: '*',
          Tagging: new URLSearchParams(object.tags.map(tag => [tag.Key, tag.Value])).toString() || undefined }));
      } finally { body.destroy(); }
    }
    const report = await verifyRestored(sql, client, config, stored);
    await sql`update public.tools_runtime_test_sentinel set sentinel_value = 'verified'
      where sentinel_key = 'release-restore-state' and sentinel_value = 'restoring'`;
    await client.send(new PutBucketTaggingCommand({ Bucket: config.bucket, Tagging: { TagSet: [
      { Key: 'tools-release-restore-owner', Value: config.owner }, { Key: 'tools-release-restore-state', Value: 'verified' }
    ] } }));
    return report;
  } finally { await sql.end(); client.destroy(); }
}

export async function verify(config, directory, { source = false } = {}) {
  const stored = await loadBackup(directory);
  if (source) requireSourceIdentity(config, stored.manifest.source);
  const { sql, client } = connections(config);
  try {
    if (!config.productionSource) await sentinel(sql);
    return await verifyRestored(sql, client, config, stored, source);
  } finally { await sql.end(); client.destroy(); }
}

async function main() {
  process.umask(0o077);
  const { values, positionals } = parseArgs({ allowPositionals: true,
    options: { tmpdir: { type: 'string', multiple: true }, directory: { type: 'string' },
      source: { type: 'boolean' }, 'production-source': { type: 'boolean' }, help: { type: 'boolean' } } });
  const [command] = positionals;
  if (values.help) {
    console.log('release-paired-backup.mjs preflight --tmpdir PATH [--tmpdir PATH]\n'
      + 'release-paired-backup.mjs backup --tmpdir PATH --directory NEW_PRIVATE_PATH\n'
      + 'release-paired-backup.mjs restore --directory BACKUP_PATH\n'
      + 'release-paired-backup.mjs verify [--source] --directory BACKUP_PATH\n'
      + 'Source uses RELEASE_* environment variables. Restore and verify use RELEASE_RESTORE_*.\n'
      + '--production-source permits explicitly scoped read-only production preflight, backup, or verify --source.\n'
      + 'See .agents/artifacts/direct-upload-release-proof-vm-20261016/interface.md.');
    return;
  }
  assert(positionals.length === 1 && ['preflight', 'backup', 'restore', 'verify'].includes(command), 'Select a release command or --help');
  assert(!values.source || command === 'verify', '--source is valid only for read-only verification');
  assert(!values['production-source'] || ['preflight', 'backup'].includes(command) || command === 'verify' && values.source,
    '--production-source is valid only for read-only source operations');
  if (command !== 'preflight') assert(values.directory, 'Pass --directory');
  const config = configuration(process.env, command === 'restore' || command === 'verify' && !values.source,
    values['production-source'] ?? false);
  const actions = { preflight: () => preflight(config, values.tmpdir ?? []),
    backup: () => backup(config, values.tmpdir ?? [], path.resolve(values.directory)),
    restore: () => restore(config, path.resolve(values.directory)), verify: () => verify(config, path.resolve(values.directory), { source: values.source ?? false }) };
  const report = await actions[command]();
  console.log(json(report).trim());
  if (command === 'preflight' && !report.releaseReady) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`Release proof failed: ${error.message}`); process.exitCode = 1; });
}

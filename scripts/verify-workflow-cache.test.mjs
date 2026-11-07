import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const workflowPath = fileURLToPath(new URL('../.github/workflows/verify.yml', import.meta.url));
const workflow = await readFile(workflowPath, 'utf8');

function step(marker) {
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `missing workflow step ${marker}`);
  const end = workflow.indexOf('\n      - ', start + marker.length);
  return workflow.slice(start, end < 0 ? undefined : end);
}

function output(stepBody) {
  const lines = stepBody.split('\n');
  const run = lines.findIndex(line => line.trim() === 'run: |');
  assert.notEqual(run, -1, 'cache readiness step has no shell script');
  const body = [];
  for (const line of lines.slice(run + 1)) {
    if (!line.startsWith('          ')) break;
    body.push(line.slice(10));
  }
  return body.join('\n');
}

test('cache save accepts a complete archive after failure and skips cancellation', async t => {
  const ready = step('      - id: minio-cache-ready');
  const verify = step('      - run: pnpm run verify');
  const restore = step('      - uses: actions/cache/restore@');
  const save = step('      - uses: actions/cache/save@');
  assert.match(ready, /if:\s*\$\{\{\s*!cancelled\(\)/);
  assert.match(ready, /steps\.minio-cache\.outputs\.cache-hit != 'true'/);
  assert.doesNotMatch(ready, /success\(\)/);
  assert.match(save, /if:\s*\$\{\{\s*!cancelled\(\)/);
  assert.match(save, /steps\.minio-cache-ready\.outputs\.ready == 'true'/);
  assert.doesNotMatch(save, /success\(\)/);
  const cachePath = body => body.match(/^\s+path:\s*(.+)$/m)?.[1];
  assert.equal(cachePath(restore), '${{ runner.temp }}/tools-verify-minio-cache');
  assert.equal(cachePath(save), cachePath(restore));
  assert.match(verify, /TOOLS_VERIFY_CACHE_DIR:\s*\$\{\{ runner\.temp \}\}\/tools-verify-minio-cache/);
  assert.match(ready, /TOOLS_VERIFY_CACHE_DIR:\s*\$\{\{ runner\.temp \}\}\/tools-verify-minio-cache/);
  assert.match(workflow.match(/push:\n([\s\S]*?)\n  pull_request:/)?.[1] ?? '', /services\/tools\/test\/harness\/minio-image\.ts/);

  const directory = await mkdtemp(path.join(os.tmpdir(), 'verify-cache-workflow-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outputPath = path.join(directory, 'github-output');
  await writeFile(outputPath, '');
  await mkdir(path.join(directory, 'cache'));
  const script = output(ready);
  const run = () => spawnSync('bash', ['-eu', '-c', script], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, TOOLS_VERIFY_CACHE_DIR: path.join(directory, 'cache'), GITHUB_OUTPUT: outputPath },
  });

  assert.equal(run().status, 0);
  assert.equal(await readFile(outputPath, 'utf8'), '');
  await writeFile(path.join(directory, 'cache', 'minio-empty.tar'), '');
  assert.equal(run().status, 0);
  assert.equal(await readFile(outputPath, 'utf8'), '');
  await writeFile(path.join(directory, 'cache', 'minio-complete.tar'), 'archive');
  assert.equal(run().status, 0);
  assert.equal(await readFile(outputPath, 'utf8'), 'ready=true\n');
});

test('cache restore and save use the same content key', () => {
  const restore = step('      - uses: actions/cache/restore@');
  const save = step('      - uses: actions/cache/save@');
  const key = body => body.match(/^\s+key:\s*(.+)$/m)?.[1];
  assert.equal(key(restore), key(save));
  assert.match(key(restore), /runner\.os/);
  assert.match(key(restore), /runner\.arch/);
  assert.match(key(restore), /Dockerfile\.minio\.local/);
  assert.match(key(restore), /services\/tools\/test\/harness\/minio-image\.ts/);
});

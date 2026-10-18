import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./validate-tracked-files.mjs', import.meta.url));
const artifactRoot = fileURLToPath(new URL('../.agents/artifacts/validate-tracked-files/', import.meta.url));
const env = {
  PATH: process.env.PATH,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: path.join(artifactRoot, 'global.gitconfig'),
  GIT_CEILING_DIRECTORIES: artifactRoot,
};

function git(directory, ...args) {
  const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8', env });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
}

async function repository(t) {
  await mkdir(artifactRoot, { recursive: true });
  const directory = await mkdtemp(path.join(artifactRoot, 'repo-'));
  t.after(() => rm(directory, { recursive: true }));
  git(directory, 'init', '--quiet');
  return directory;
}

function validate(directory, environment = env) {
  return spawnSync(process.execPath, [script], { cwd: directory, encoding: 'utf8', env: environment });
}

test('clean tracked files pass with untracked ignored content and personal excludes', async t => {
  const directory = await repository(t);
  await writeFile(path.join(directory, '.gitignore'), '*.log\n');
  await writeFile(path.join(directory, 'untracked.log'), 'ignored');
  await writeFile(path.join(directory, 'global-only.txt'), 'tracked');
  await writeFile(path.join(directory, 'local-only.txt'), 'tracked');
  git(directory, 'add', '.');
  await writeFile(path.join(directory, '.git', 'personal-excludes'), 'global-only.txt\n');
  git(directory, 'config', 'core.excludesFile', path.join(directory, '.git', 'personal-excludes'));
  await writeFile(path.join(directory, '.git', 'info', 'exclude'), 'local-only.txt\n');

  const result = validate(directory);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
});

test('force-added ignored paths fail with intact spaced and newline filenames', async t => {
  const directory = await repository(t);
  const ignoredPaths = ['normal.log', 'with spaces.log', 'with\nnewline.log'];
  await writeFile(path.join(directory, '.gitignore'), '*.log\n');
  for (const name of ignoredPaths) await writeFile(path.join(directory, name), 'ignored');
  git(directory, 'add', '--force', '--', ...ignoredPaths);

  const result = validate(directory);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /tracked files.*\.gitignore/i);
  for (const name of ignoredPaths) assert(result.stderr.includes(JSON.stringify(name)), result.stderr);
});

test('nested ignore rules and negations select only offending tracked paths', async t => {
  const directory = await repository(t);
  await mkdir(path.join(directory, 'nested'));
  await writeFile(path.join(directory, '.gitignore'), '*.log\n!keep.log\n');
  await writeFile(path.join(directory, 'nested', '.gitignore'), '*.tmp\n!keep.tmp\nkeep.log\n!nested-keep.log\n');
  const allowedPaths = ['keep.log', 'nested/keep.tmp', 'nested/nested-keep.log'];
  for (const name of allowedPaths) await writeFile(path.join(directory, name), 'allowed');
  git(directory, 'add', '.');
  const clean = validate(directory);
  assert.equal(clean.status, 0, clean.stderr);

  const ignoredPaths = ['nested/blocked.tmp', 'nested/keep.log'];
  for (const name of ignoredPaths) await writeFile(path.join(directory, name), 'ignored');
  git(directory, 'add', '--force', '--', ...ignoredPaths);
  const result = validate(directory);
  assert.equal(result.status, 1);
  for (const name of ignoredPaths) assert(result.stderr.includes(JSON.stringify(name)), result.stderr);
  for (const name of allowedPaths) assert(!result.stderr.includes(JSON.stringify(name)), result.stderr);
});

test('a Git failure reports its diagnostic and fails validation', async t => {
  const directory = await repository(t);
  await writeFile(path.join(directory, '.git', 'index'), 'invalid index');

  const result = validate(directory);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Git/);
  assert.match(result.stderr, /index/i);
});

test('an unavailable Git executable reports an error and fails validation', async t => {
  const directory = await repository(t);

  const result = validate(directory, { ...env, PATH: directory });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Git/);
  assert.match(result.stderr, /ENOENT/);
});

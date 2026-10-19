import { spawnSync } from 'node:child_process';

const result = spawnSync('git', [
  'ls-files', '--cached', '--ignored', '--exclude-per-directory=.gitignore', '-z',
], { encoding: 'utf8' });

if (result.error || result.status !== 0) {
  console.error('Unable to check tracked files with Git.');
  console.error(result.error?.message || result.stderr?.trim() || `Git exited with status ${result.status} and signal ${result.signal}.`);
  process.exitCode = 1;
} else {
  const ignoredPaths = result.stdout.split('\0').filter(Boolean);
  if (ignoredPaths.length > 0) {
    console.error('Tracked files match .gitignore rules:');
    for (const path of ignoredPaths) console.error(`  ${JSON.stringify(path)}`);
    process.exitCode = 1;
  }
}

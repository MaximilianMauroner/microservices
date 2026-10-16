import json
import os
from pathlib import Path
import subprocess
import sys
from build import ROOT, source_hash

directory = Path(__file__).resolve().parent
environment = {name: os.environ[name] for name in
               ('PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'TERM') if name in os.environ}
environment.update({'VITEST_MAX_WORKERS': '1', 'pnpm_config_verify_deps_before_run': 'false',
                    'TMPDIR': '/home/codex/.local/share/direct-upload-vm-20261016/verify-tmp'})
commands = [
    ('backup-boundaries-final.log', ['node', '--test', 'services/tools/publisher/scripts/release-paired-backup.test.mjs']),
    ('build-logical-guard-final.log', ['python3', str(directory / 'build.py')]),
    ('verify-logical-guard-final.log', ['python3', str(directory / 'verify.py')]),
]
before = source_hash()
proof = {'revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
         'sourceSha256Before': before, 'checks': []}
for name, command in commands:
    with (directory / name).open('w') as output:
        result = subprocess.run(['heavy-check', '--repo', str(ROOT), '--lock-timeout', '3600', '--', *command],
                                cwd=ROOT, env=environment, stdout=output, stderr=subprocess.STDOUT)
    proof['checks'].append({'command': command, 'log': name, 'exitCode': result.returncode})
    proof['sourceSha256After'] = source_hash()
    proof['sourceFrozen'] = proof['sourceSha256After'] == before
    (directory / 'final-checks-result.json').write_text(json.dumps(proof, indent=2) + '\n')
    print(json.dumps(proof['checks'][-1]), flush=True)
    if result.returncode or not proof['sourceFrozen']:
        sys.exit(result.returncode or 1)

import json
import os
from pathlib import Path
import subprocess
import sys
from build import ROOT, source_hash

before = source_hash()
revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
result = subprocess.run(['pnpm', 'run', 'verify'], cwd=ROOT)
after = source_hash()
proof = {'command': 'pnpm run verify', 'exitCode': result.returncode, 'revision': revision,
         'sourceSha256Before': before, 'sourceSha256After': after, 'sourceFrozen': before == after,
         'node': subprocess.check_output(['node', '--version'], text=True).strip(),
         'maxVitestWorkers': os.environ.get('VITEST_MAX_WORKERS'),
         'resourceSkipsAreNotPasses': True}
Path(__file__).with_name('verify-result.json').write_text(json.dumps(proof, indent=2) + '\n')
print(json.dumps(proof))
sys.exit(result.returncode if before == after else 1)

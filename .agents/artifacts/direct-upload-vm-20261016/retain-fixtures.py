import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import tarfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[3]
STATE = Path('/dev/shm/direct-upload-vm-recovery-20261016')
DESTINATION = Path('/home/codex/.local/share/direct-upload-vm-20261016/primary-retained')
assert json.loads((STATE / 'owner.json').read_text())['root'] == str(ROOT)
os.umask(0o077)
DESTINATION.mkdir(mode=0o700, exist_ok=True)
run = Path((STATE / 'latest-cli-run').read_text().strip())
assert run.parent == STATE
prefix = str(uuid.uuid4())


def archive(label):
    target = DESTINATION / (prefix + '-' + label + '.tar')
    with tarfile.open(target, 'x') as output:
        output.add(STATE, arcname=STATE.name)
    with target.open('rb') as stream:
        sha256 = hashlib.file_digest(stream, 'sha256').hexdigest()
    return target, {'path': str(target), 'bytes': target.stat().st_size, 'sha256': sha256}


def stop_process(pid_file, expected):
    pid = int(pid_file.read_text())
    proc = Path('/proc') / str(pid)
    if not proc.exists() or proc.joinpath('stat').read_text().split(') ')[1].startswith('Z'):
        return
    assert proc.joinpath('cwd').resolve() == ROOT, 'The PID belongs to another checkout'
    command = proc.joinpath('cmdline').read_bytes().replace(b'\0', b' ').decode()
    assert expected in command, 'The PID belongs to another command'
    os.kill(pid, signal.SIGTERM)
    for _ in range(100):
        if not proc.exists() or proc.joinpath('stat').read_text().split(') ')[1].startswith('Z'):
            return
        time.sleep(0.1)
    raise RuntimeError('The owned process did not stop')


_, before = archive('pre-stop')
stop_process(run / 'app.pid', 'services/tools/.output/server/index.mjs')
stop_process(run / 'proxy.pid', str(ROOT / '.agents/artifacts/direct-upload-vm-20261016/observe.py'))
subprocess.run(['python3', str(ROOT / '.agents/skills/verify-tools/scripts/native-fixtures.py'),
                'stop', '--state', str(STATE)], cwd=ROOT, check=True)
assert not (STATE / 'database/postmaster.pid').exists()
ports = (43171, 43173, 45432, 49000, 49001)
for port in ports:
    with socket.socket() as connection:
        assert connection.connect_ex(('127.0.0.1', port)) != 0, 'An owned port is still open'

target, stopped = archive('stopped')
files = 0
with tarfile.open(target) as retained:
    for member in retained:
        if not member.isfile():
            continue
        relative = Path(member.name).relative_to(STATE.name)
        with retained.extractfile(member) as saved, (STATE / relative).open('rb') as source:
            assert hashlib.file_digest(saved, 'sha256').digest() == hashlib.file_digest(source, 'sha256').digest()
        files += 1
stopped['verifiedRegularFiles'] = files
result = {'preStopArchive': before, 'stoppedArchive': stopped,
          'closedOwnedPorts': list(ports), 'sourceStateRetained': STATE.is_dir(),
          'secretsAndBodies': 'private durable archives only'}
Path(__file__).with_name('archive-proof.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))

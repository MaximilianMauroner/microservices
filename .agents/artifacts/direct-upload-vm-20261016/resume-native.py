import importlib.util
from pathlib import Path
import socket
import subprocess
import sys
import time

root = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('native', root / '.agents/skills/verify-tools/scripts/native-fixtures.py')
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)
state = Path(sys.argv[1]).resolve()
owner = native.owner(state)
env = native.environment(state)
for port in (owner['databasePort'], owner['storagePort'], owner['storagePort'] + 1):
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', port))
pg = Path(owner['pg'])
subprocess.run([str(pg / 'pg_ctl'), '-D', str(state / 'database'), '-l', str(state / 'postgres.log'),
                '-o', f"-h 127.0.0.1 -p {owner['databasePort']} -c unix_socket_directories=''", '-w', 'start'],
               cwd=root, env=env, check=True)
with (state / 'storage.log').open('a') as log:
    process = subprocess.Popen([owner['s3'], 'server', '--address', f"127.0.0.1:{owner['storagePort']}",
                                '--console-address', f"127.0.0.1:{owner['storagePort'] + 1}", str(state / 'bodies')],
                               cwd=state, env=env, stdout=log, stderr=log, start_new_session=True)
(state / 'storage.pid').write_text(str(process.pid))
native.wait_for(lambda: native.healthy(env['ARTIFACT_S3_ENDPOINT'] + '/health'))
print('Resumed exact owned native fixtures. All existing database files and bodies retained.')

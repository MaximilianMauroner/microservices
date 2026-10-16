import hashlib
from pathlib import Path
import tarfile
import urllib.request
import zipfile
root = Path('/home/codex/.local/share/direct-upload-vm-20261016/deps')
def fetch(url, destination):
    urllib.request.urlretrieve(url, destination)
base = 'https://github.com/rustfs/rustfs/releases/download/1.0.1/'
name = 'rustfs-linux-x86_64-gnu-v1.0.1.zip'
fetch(base + 'SHA256SUMS', root / 'rustfs-SHA256SUMS')
fetch(base + name, root / name)
expected = next(line.split()[0] for line in (root / 'rustfs-SHA256SUMS').read_text().splitlines() if line.split()[-1].lstrip('*') == name)
assert hashlib.file_digest((root / name).open('rb'), 'sha256').hexdigest() == expected
with zipfile.ZipFile(root / name) as archive:
    with archive.open('rustfs') as source, (root / 'rustfs').open('wb') as destination:
        import shutil
        shutil.copyfileobj(source, destination)
(root / 'rustfs').chmod(0o700)
print('RustFS official release SHA256 verified', expected, flush=True)
node = 'node-v22.23.3-linux-x64.tar.xz'
base = 'https://nodejs.org/dist/v22.23.3/'
fetch(base + 'SHASUMS256.txt', root / 'node-SHASUMS256.txt')
fetch(base + node, root / node)
expected = next(line.split()[0] for line in (root / 'node-SHASUMS256.txt').read_text().splitlines() if line.split()[-1] == node)
assert hashlib.file_digest((root / node).open('rb'), 'sha256').hexdigest() == expected
with tarfile.open(root / node) as archive:
    archive.extractall(root, filter='data')
print('Node official release SHA256 verified', expected)

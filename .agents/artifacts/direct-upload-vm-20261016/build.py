import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]


def source_hash():
    names = subprocess.check_output(["git", "ls-files", "-z", "services/tools", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"], cwd=ROOT).split(b"\0")
    value = hashlib.sha256()
    for name in sorted(name for name in names if name):
        value.update(name + b"\0")
        value.update((ROOT / name.decode()).read_bytes())
    return value.hexdigest()


if __name__ == "__main__":
    before = source_hash()
    subprocess.run(["pnpm", "--dir", "services/tools", "run", "build"], cwd=ROOT, check=True)
    assert source_hash() == before, "Application source changed during build"
    metadata = {"sourceSha256": before,
                "revision": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
                "dirtyDiffSha256": hashlib.sha256(subprocess.check_output(["git", "diff", "HEAD", "--", "services/tools", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"], cwd=ROOT)).hexdigest()}
    (ROOT / "services/tools/.output/build-source-proof.json").write_text(json.dumps(metadata))
    print(json.dumps(metadata))

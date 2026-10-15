#!/usr/bin/env python3
"""Run owned native PostgreSQL and S3 fixtures for Tools verification."""

import argparse
import base64
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import time
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[4]
PURPOSE = "tools-native-verification-v1"


def execute(command, environment=None, capture=False):
    return subprocess.run(command, cwd=ROOT, env=environment, check=True,
                          text=True, capture_output=capture)


def environment(state):
    inherited = {name: os.environ[name] for name in
                 ("PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "TERM", "SHELL")
                 if name in os.environ}
    return {**inherited, **json.loads((state / "environment.json").read_text())}


def owner(state):
    value = json.loads((state / "owner.json").read_text())
    if value["purpose"] != PURPOSE or value["root"] != str(ROOT):
        raise RuntimeError("The state directory is not owned by this checkout's verifier")
    return value


def wait_for(check):
    for _ in range(60):
        try:
            if check():
                return
        except (OSError, RuntimeError):
            pass
        time.sleep(0.5)
    raise RuntimeError("Owned fixture did not become ready within 30 seconds")


def healthy(url):
    with urlopen(url, timeout=2) as response:
        return response.status == 200


def available(port):
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", port))


def start(args):
    state = args.state
    state.mkdir(parents=True, exist_ok=True)
    if any(state.iterdir()):
        raise RuntimeError("Start requires an empty state directory")
    state.chmod(0o700)
    pg = args.pg_bin.resolve()
    s3 = args.s3_bin.resolve()
    for binary in (pg / "initdb", pg / "pg_ctl", pg / "psql", pg / "createdb", s3):
        if not binary.is_file() or not os.access(binary, os.X_OK):
            raise RuntimeError(f"Required native executable is missing: {binary}")
    if not shutil.which("pnpm"):
        raise RuntimeError("pnpm 11.16.0 must be on PATH")
    for port in (args.database_port, args.storage_port, args.storage_port + 1, args.app_port):
        available(port)
    metadata = {"purpose": PURPOSE, "root": str(ROOT), "pg": str(pg), "s3": str(s3),
                "databasePort": args.database_port, "storagePort": args.storage_port,
                "appPort": args.app_port}
    (state / "owner.json").write_text(json.dumps(metadata))
    database_url = f"postgres://transfer_test@127.0.0.1:{args.database_port}/tools_runtime_test"
    endpoint = f"http://127.0.0.1:{args.storage_port}"
    origin = f"http://127.0.0.1:{args.app_port}"
    values = {
        "NODE_ENV": "development", "TOOLS_ENVIRONMENT": "local",
        "DATABASE_URL": database_url, "TEST_DATABASE_URL": database_url,
        "TOOLS_TEST_DATABASE_CONFIRM": "tools-platform-test",
        "PUBLISHER_TRANSFER_TEST_DATABASE_URL": database_url,
        "PUBLISHER_TRANSFER_TEST_S3_ENDPOINT": endpoint,
        "PUBLIC_ORIGIN": origin, "PUBLIC_BASE_URL": origin,
        "LOCAL_PLATFORM_BROWSER_ORIGIN": origin,
        "LOCAL_PLATFORM_INTERNAL_ORIGIN": origin,
        "LOCAL_MARKDOWN_INTERNAL_ORIGIN": "http://127.0.0.1:48787",
        "PORT": str(args.app_port), "UPLOAD_TOKEN": secrets.token_urlsafe(32),
        "BETTER_AUTH_SECRET": secrets.token_urlsafe(32),
        "FEEDBACK_ENCRYPTION_KEY": base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip("="),
        "GOOGLE_CLIENT_ID": "local-client.apps.googleusercontent.com",
        "GOOGLE_CLIENT_SECRET": "local-only", "AUTH_ALLOWED_GOOGLE_SUBJECT": "local-only",
        "TOWER_HEARTBEAT_TOKEN": secrets.token_urlsafe(32),
        "MARKDOWN_SHARE_ADMIN_ENDPOINT": "http://127.0.0.1:48787/admin/documents",
        "MARKDOWN_SHARE_ADMIN_TOKEN": secrets.token_urlsafe(32),
        "VITE_CONVEX_URL": "http://localhost:3210", "SEED_RETRY_ATTEMPTS": "1",
        "RUSTFS_ACCESS_KEY": "transfer-local", "RUSTFS_SECRET_KEY": "transfer-local-secret",
        "RUSTFS_CONSOLE_ENABLE": "false",
    }
    for prefix, bucket in (("TOOLS", "tools-native-test"), ("ARTIFACT", "tools-transfer-test")):
        values.update({f"{prefix}_S3_BUCKET": bucket, f"{prefix}_S3_ENDPOINT": endpoint,
                       f"{prefix}_S3_REGION": "us-east-1", f"{prefix}_S3_ACCESS_KEY_ID": "transfer-local",
                       f"{prefix}_S3_SECRET_ACCESS_KEY": "transfer-local-secret",
                       f"{prefix}_S3_FORCE_PATH_STYLE": "true"})
    secret_path = state / "environment.json"
    secret_path.write_text(json.dumps(values))
    secret_path.chmod(0o600)
    env = environment(state)
    try:
        execute([str(pg / "initdb"), "-D", str(state / "database"), "-U", "transfer_test",
                 "--auth-local=trust", "--auth-host=trust", "--encoding=UTF8", "--locale=C"], env)
        execute([str(pg / "pg_ctl"), "-D", str(state / "database"), "-l", str(state / "postgres.log"),
                 "-o", f"-h 127.0.0.1 -p {args.database_port} -c unix_socket_directories=''", "-w", "start"], env)
        execute([str(pg / "createdb"), "-h", "127.0.0.1", "-p", str(args.database_port),
                 "-U", "transfer_test", "tools_runtime_test"], env)
        execute([str(pg / "psql"), database_url, "-v", "ON_ERROR_STOP=1", "-c",
                 "create table tools_runtime_test_sentinel(sentinel_key text primary key, sentinel_value text not null); "
                 "insert into tools_runtime_test_sentinel values ('database-purpose','tools-runtime-disposable-test-database');"], env)
        execute(["pnpm", "--dir", "services/tools", "run", "db:push-postgres:test"], env)
        (state / "bodies").mkdir()
        with (state / "storage.log").open("w") as log:
            process = subprocess.Popen([str(s3), "server", "--address", f"127.0.0.1:{args.storage_port}",
                                        "--console-address", f"127.0.0.1:{args.storage_port + 1}",
                                        str(state / "bodies")], cwd=state, env=env,
                                       stdout=log, stderr=log, start_new_session=True)
        (state / "storage.pid").write_text(str(process.pid))
        wait_for(lambda: healthy(endpoint + "/health"))
        execute(["pnpm", "--dir", "services/tools/status", "run", "seed-local"], env)
        execute(["node", str(Path(__file__).with_name("storage-cors.mjs"))], env)
    except BaseException:
        stop(state)
        raise
    print(f"Native fixtures ready. State retained at {state}")


def stop(state):
    metadata = owner(state)
    pid_path = state / "storage.pid"
    if pid_path.exists():
        pid = int(pid_path.read_text())
        result = subprocess.run(["ps", "-ww", "-p", str(pid), "-o", "stat=", "-o", "command="], capture_output=True, text=True)
        if result.returncode == 0 and not result.stdout.strip().startswith("Z"):
            if str(state / "bodies") not in result.stdout or metadata["s3"] not in result.stdout:
                raise RuntimeError("Storage PID no longer belongs to this verifier")
            os.kill(pid, signal.SIGTERM)
            def stopped():
                status = subprocess.run(["ps", "-p", str(pid), "-o", "stat="], capture_output=True, text=True)
                return status.returncode != 0 or status.stdout.strip().startswith("Z")
            wait_for(stopped)
    pg = Path(metadata["pg"])
    if (state / "database/postmaster.pid").exists():
        execute([str(pg / "pg_ctl"), "-D", str(state / "database"), "-m", "fast", "-w", "stop"])
    print("Owned fixtures stopped. Data and evidence retained.")


def doctor(state):
    metadata = owner(state)
    env = environment(state)
    execute([str(Path(metadata["pg"]) / "pg_ctl"), "-D", str(state / "database"), "status"], capture=True)
    actual = execute([str(Path(metadata["pg"]) / "psql"), env["DATABASE_URL"], "-Atc",
                      "select sentinel_value from tools_runtime_test_sentinel where sentinel_key='database-purpose'"], env, True).stdout.strip()
    if actual != "tools-runtime-disposable-test-database":
        raise RuntimeError("Disposable database sentinel does not match")
    if not healthy(env["ARTIFACT_S3_ENDPOINT"] + "/health"):
        raise RuntimeError("Owned storage is not ready")
    for path in ("/live", "/health"):
        if not healthy(env["PUBLIC_ORIGIN"] + path):
            raise RuntimeError(f"Tools {path} is not ready")
    print(json.dumps({"nativeFixtures": "passed", "databaseSentinel": "passed", "tools": "passed",
                      "origin": env["PUBLIC_ORIGIN"], "state": str(state)}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("start", "doctor", "run", "stop"))
    parser.add_argument("--state", required=True, type=Path)
    parser.add_argument("--pg-bin", type=Path, help="PostgreSQL executable directory, e.g. pg_config --bindir")
    parser.add_argument("--s3-bin", type=Path, help="Path to the native RustFS 1.0.1 executable")
    parser.add_argument("--database-port", type=int, default=45432)
    parser.add_argument("--storage-port", type=int, default=49000)
    parser.add_argument("--app-port", type=int, default=43171)
    args, command = parser.parse_known_args()
    args.state = args.state.resolve()
    if args.action == "start":
        if not args.pg_bin or not args.s3_bin:
            parser.error("start requires --pg-bin and --s3-bin")
        start(args)
    elif args.action == "doctor":
        doctor(args.state)
    elif args.action == "stop":
        stop(args.state)
    else:
        owner(args.state)
        if command[:1] == ["--"]:
            command = command[1:]
        if not command:
            parser.error("run requires -- followed by a command")
        return subprocess.run(command, cwd=ROOT, env=environment(args.state)).returncode
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Native verification failed: {error}", file=sys.stderr)
        sys.exit(1)

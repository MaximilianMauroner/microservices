import argparse
import atexit
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import uuid
from build import source_hash

parser = argparse.ArgumentParser()
parser.add_argument("--state", type=Path, required=True)
parser.add_argument("--fleet", type=Path, required=True)
parser.add_argument("--keep-app", action="store_true")
args = parser.parse_args()
state = args.state.resolve()
root = Path(__file__).resolve().parents[3]
assert json.loads((state / "owner.json").read_text())["root"] == str(root)
env = {**os.environ, **json.loads((state / "environment.json").read_text())}
assert env["PUBLIC_BASE_URL"] == "http://127.0.0.1:43171"
assert env["ARTIFACT_S3_ENDPOINT"] == "http://127.0.0.1:49000"
fixture_state = state
state = fixture_state / ("cli-run-" + str(uuid.uuid4()))
state.mkdir(mode=0o700)
(state / "environment.json").write_text(json.dumps({**env, "PATH": env["PATH"]}))
(state / "environment.json").chmod(0o600)
(fixture_state / "latest-cli-run").write_text(str(state))
build = json.loads((root / "services/tools/.output/build-source-proof.json").read_text())
assert source_hash() == build["sourceSha256"], "Build does not match current application source"
for port in (43171, 43173):
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", port))
(state / "tmp").mkdir(exist_ok=True)
env.update(PORT="43173", HOST="127.0.0.1", TMPDIR=str(state / "tmp"))
fixtures = state / "fixtures"
fixtures.mkdir(exist_ok=True)
results = {}
owned = []
completed_ok = False
fault_offsets = (0, 0)


def cleanup():
    if completed_ok and args.keep_app:
        return
    for process in reversed(owned):
        if process.poll() is None:
            stop(process)


atexit.register(cleanup)


def wait(check):
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        try:
            if check():
                return
        except OSError:
            pass
        time.sleep(0.2)
    raise RuntimeError("Owned app or interruption did not become ready")


def ready():
    return urlopen("http://127.0.0.1:43171/live", timeout=2).status == 200


def launch_app():
    log = (state / "app.log").open("a")
    process = subprocess.Popen(["node", "services/tools/.output/server/index.mjs"], cwd=root,
                               env=env, stdout=log, stderr=log, start_new_session=True)
    (state / "app.pid").write_text(str(process.pid))
    owned.append(process)
    def alive_and_ready():
        if process.poll() is not None:
            raise RuntimeError("Owned application exited before readiness")
        return ready()
    wait(alive_and_ready)
    listeners = subprocess.check_output(["ss", "-H", "-lntp", "sport = :43173"], text=True)
    assert f"pid={process.pid}," in listeners, "Readiness came from a different process"
    return process


def stop(process):
    os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=30)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=10)


def fault(action, mode, **values):
    global fault_offsets
    def count(name):
        path = state / name
        return len(path.read_text().splitlines()) if path.exists() else 0
    fault_offsets = (count("requests.jsonl"), count("faults.jsonl"))
    (state / "proxy-control.json").write_text(json.dumps({"action": action, "mode": mode, **values}))


def assert_fault(action, mode):
    assert json.loads((state / "proxy-control.json").read_text()) == {}, "Fault did not fire"
    events = [json.loads(line) for line in (state / "faults.jsonl").read_text().splitlines()[fault_offsets[1]:]]
    matches = [event for event in events if event["action"] == action and event["mode"] == mode]
    assert matches and (mode == "hold" or matches[-1]["status"] in (200, 201))
    if mode == "drop":
        requests = [json.loads(line) for line in (state / "requests.jsonl").read_text().splitlines()[fault_offsets[0]:]]
        route = "/api/uploads/sessions" + ("/:id/complete" if action == "complete" else "")
        assert sum(request["route"] == route for request in requests) >= 2


def command(source, request, *, replace=None, ts=False):
    if ts:
        return [str(root / "services/tools/publisher/node_modules/.bin/tsx"),
                str(root / "services/tools/publisher/scripts/upload-direct.ts"), str(source), request]
    return ["python3", str(args.fleet / "skills/file-upload/scripts/upload.py"), str(source),
            "--request-id", request, *(["--replace-id", replace] if replace else ["--project", "vm-proof"])]


def cli(source, *, request=None, replace=None, ts=False, success=True):
    request = request or str(uuid.uuid4())
    completed = subprocess.run(command(source, request, replace=replace, ts=ts), cwd=root, env=env,
                               capture_output=True, text=True, timeout=180)
    with (state / "cli-output.jsonl").open("a") as log:
        log.write(json.dumps({"request": request, "returncode": completed.returncode,
                              "stdout": completed.stdout, "stderr": completed.stderr}) + "\n")
    if not success:
        assert completed.returncode != 0, "Source mutation was accepted"
        assert ("The file changed during upload." if ts else "source file changed while it was being uploaded") in completed.stderr, completed.stderr
        return None
    assert completed.returncode == 0, completed.stderr
    result = json.loads(completed.stdout.splitlines()[-1])
    assert result["sha256"] == hashlib.sha256(source.read_bytes()).hexdigest()
    assert result["bytes"] == source.stat().st_size
    return result


def inspect(label, result, source):
    subprocess.run(["node", str(Path(__file__).with_name("inspect.mjs")), str(state), label,
                    result["id"], str(source)], cwd=root, env=env, check=True, timeout=60)


proxy_log = (state / "proxy.log").open("a")
proxy = subprocess.Popen(["python3", str(Path(__file__).with_name("observe.py")), str(state)], cwd=root,
                         env=env, stdout=proxy_log, stderr=proxy_log, start_new_session=True)
(state / "proxy.pid").write_text(str(proxy.pid))
owned.append(proxy)
app = launch_app()
assert urlopen("http://127.0.0.1:43171/health", timeout=30).status == 200
assert "/sign-in" in urlopen("http://127.0.0.1:43171/publisher", timeout=30).url
for token in (None, "wrong-local-token"):
    headers = {"Content-Type": "application/json", "Origin": "http://127.0.0.1:43171"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    for suffix, method in (("", "POST"), ("/" + str(uuid.uuid4()), "GET"),
                           ("/" + str(uuid.uuid4()) + "/parts", "POST"),
                           ("/" + str(uuid.uuid4()) + "/complete", "POST"),
                           ("/" + str(uuid.uuid4()), "DELETE")):
        try:
            urlopen(Request("http://127.0.0.1:43171/api/uploads/sessions" + suffix,
                            data=b"{}" if method == "POST" else None, headers=headers, method=method), timeout=30)
            raise AssertionError("Native API accepted a missing or incorrect bearer")
        except HTTPError as error:
            assert error.code == 401
try:
    urlopen(Request("http://127.0.0.1:43171/api/external-uploads/sessions", data=b"{}",
                    headers={"Authorization": "Bearer " + env["UPLOAD_TOKEN"],
                             "Content-Type": "application/json", "Origin": "http://127.0.0.1:43171"}), timeout=30)
    raise AssertionError("Native bearer crossed the browser session boundary")
except HTTPError as error:
    assert error.code == 401
original = fixtures / "original.html"
original.write_text("<!doctype html><html><title>VM upload proof</title><h1>DIRECT-UPLOAD-VM-BODY original</h1>" + "x" * 1048576 + "</html>")
revised = fixtures / "revised.html"
revised.write_text("<!doctype html><html><title>VM replacement proof</title><h1>DIRECT-UPLOAD-VM-BODY revised</h1></html>")
results["fleetCreate"] = cli(original)
inspect("before", results["fleetCreate"], original)
fault("init", "drop")
results["fleetReplace"] = cli(revised, replace=results["fleetCreate"]["id"])
assert_fault("init", "drop")
assert results["fleetReplace"]["url"] == results["fleetCreate"]["url"]
inspect("after", results["fleetReplace"], revised)
fault("complete", "drop")
results["lostComplete"] = cli(original)
assert_fault("complete", "drop")
fault("complete", "hold")
resume = str(uuid.uuid4())
pending = subprocess.Popen(command(revised, resume, replace=results["fleetCreate"]["id"]), cwd=root,
                           env=env, stdout=(state / "interrupted.stdout").open("w"),
                           stderr=(state / "interrupted.stderr").open("w"), start_new_session=True)
wait(lambda: (state / "proxy-held").exists())
assert_fault("complete", "hold")
stop(pending)
stop(app)
(state / "proxy-release").write_text("release")
app = launch_app()
results["restartResume"] = cli(revised, request=resume, replace=results["fleetCreate"]["id"])
assert results["restartResume"]["url"] == results["fleetCreate"]["url"]
results["repeatComplete"] = cli(revised, request=resume, replace=results["fleetCreate"]["id"])
assert results["repeatComplete"] == results["restartResume"]
fault("complete", "commit-hold")
committed_request = str(uuid.uuid4())
pending = subprocess.Popen(command(original, committed_request), cwd=root, env=env,
                           stdout=(state / "committed-interrupted.stdout").open("w"),
                           stderr=(state / "committed-interrupted.stderr").open("w"), start_new_session=True)
wait(lambda: (state / "committed-held").exists())
assert_fault("complete", "commit-hold")
committed = json.loads((state / "committed-result.json").read_text())
stop(pending)
stop(app)
(state / "committed-release").write_text("release")
app = launch_app()
results["committedRestartResume"] = cli(original, request=committed_request)
assert results["committedRestartResume"] == committed
for ts in (False, True):
    source = fixtures / ("mutate-ts.html" if ts else "mutate-fleet.html")
    source.write_bytes(original.read_bytes())
    request = str(uuid.uuid4())
    fault("parts", "mutate", source=str(source))
    cli(source, request=request, ts=ts, success=False)
    assert_fault("parts", "mutate")
    source.write_bytes(original.read_bytes())
    results["mutationRecoveryTs" if ts else "mutationRecoveryFleet"] = cli(source, request=request, ts=ts)
fault("init", "drop")
results["tsCreate"] = cli(original, ts=True)
assert_fault("init", "drop")
pdf = fixtures / "proof.pdf"
objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
           b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
           b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
content = b"BT /F1 20 Tf 70 700 Td (DIRECT-UPLOAD-VM PDF viewer proof) Tj ET"
objects.append(b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"\nendstream")
body = b"%PDF-1.4\n"
offsets = [0]
for index, obj in enumerate(objects, 1):
    offsets.append(len(body))
    body += str(index).encode() + b" 0 obj\n" + obj + b"\nendobj\n"
xref = len(body)
body += b"xref\n0 6\n0000000000 65535 f \n" + b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets[1:])
body += f"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
pdf.write_bytes(body)
results["pdf"] = cli(pdf)
inspect("pdf", results["pdf"], pdf)
results["binaryPdf"] = cli(pdf, ts=True)
for result in (results["pdf"], results["binaryPdf"]):
    with urlopen(result["url"], timeout=30) as response:
        assert response.headers.get_content_type() == "application/pdf"
        assert response.headers["Content-Disposition"].startswith("inline;")
        assert response.read() == pdf.read_bytes()
    with urlopen(result["downloadUrl"], timeout=30) as response:
        assert response.headers["Content-Disposition"].startswith("attachment;")
        assert response.read() == pdf.read_bytes()
    with urlopen(Request(result["url"], method="HEAD"), timeout=30) as response:
        assert response.headers.get_content_type() == "application/pdf"
        assert int(response.headers["Content-Length"]) == pdf.stat().st_size
    with urlopen(Request(result["url"], headers={"Range": "bytes=0-7"}), timeout=30) as response:
        assert response.status == 206
        assert response.read() == pdf.read_bytes()[:8]
assert original.exists() and revised.exists() and pdf.exists()
(state / "results.json").write_text(json.dumps(results, indent=2))
requests = [json.loads(line) for line in (state / "requests.jsonl").read_text().splitlines()]
native = [request for request in requests if request["route"].startswith("/api/uploads")]
assert all(request["route"].startswith("/api/uploads/sessions") for request in native)
assert not any(request["hasFixtureBody"] for request in native)
assert max(request["bytes"] for request in native) < 4096
assert all(not request["hasTransferEncoding"] and not request["hasFixtureBody"] and request["bytes"] < 4096 for request in requests)
assert all(request["route"].startswith(("/api/uploads/sessions", "/api/external-uploads/sessions"))
           for request in requests if request["method"] in ("POST", "PUT", "PATCH", "DELETE"))
report = {"fleetCreateReplace": "passed", "lostInitializationResponse": "passed",
          "lostCompletionResponse": "passed", "realAppRestartSameUuid": "passed",
          "duplicateCompletion": "passed", "fleetSourceMutation": "passed", "tsSourceMutation": "passed",
          "committedCompletionAcrossAppRestart": "passed", "pdfHttpInlineDownloadHeadRange": "passed",
          "tsDirectCreate": "passed", "sourceFilesRetained": "passed", "nativeRequests": len(native),
          "nativeRequestBodyBytes": sum(request["bytes"] for request in native),
          "largestNativeRequestBody": max(request["bytes"] for request in native),
          "fixtureMarkerInNativeRequests": False, "browserPdf": "unrun", "health": "passed",
          "nativeBearerBoundary": "passed", "privatePageRedirect": "passed", "browserSessionBoundary": "passed", "build": build}
(root / ".agents/artifacts/direct-upload-vm-20261016/live-cli-result.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report))
completed_ok = True

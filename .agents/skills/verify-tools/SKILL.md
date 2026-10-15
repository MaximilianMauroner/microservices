---
name: verify-tools
description: Verify Mauroner Tools through its real browser pages and native upload CLI with owned native PostgreSQL and S3 processes. Use for Publisher, authentication, or Tools product acceptance checks.
---

# Verify Tools

Read `AGENTS.md`, `services/tools/README.md`, and the selected service README.
Use [the feature map](features/README.md) to select the actual user paths.
Do not use Docker. Do not use production data or installed client credentials.

## Launch

Use Node >=22.12 and pnpm 11.16.0 through Corepack. Check active threads,
Git status, free disk, and listeners before setup. Install with
`pnpm install --frozen-lockfile`. Run from the repository root.

The native fixture helper needs PostgreSQL 16 executables and a native RustFS
binary. On this Mac, PostgreSQL is under `/opt/homebrew/opt/postgresql@16/bin`.
RustFS 1.0.1 provides `rustfs-macos-aarch64-v1.0.1.zip` and `SHA256SUMS` at
`https://github.com/rustfs/rustfs/releases/tag/1.0.1`. Check the archive against
that checksum before use. Other hosts must supply their native binaries.
Do not start a Homebrew service or reuse its default cluster.

Create a private state directory outside the checkout. Use unused loopback
ports. This command creates a fresh cluster, the disposable database sentinel,
the typed schemas, private buckets, and local seed snapshots:

```sh
TOOLS_VERIFY_STATE=$(mktemp -d /tmp/tools-verify.XXXXXX)
python3 .agents/skills/verify-tools/scripts/native-fixtures.py start   --state "$TOOLS_VERIFY_STATE"   --pg-bin /opt/homebrew/opt/postgresql@16/bin   --s3-bin /tmp/direct-upload-native-deps-20261015/rustfs
python3 .agents/skills/verify-tools/scripts/native-fixtures.py run   --state "$TOOLS_VERIFY_STATE" -- pnpm --dir services/tools run dev   --host 127.0.0.1 --port 43171 --strictPort
```

Retain the state path and the web terminal handle. Require `/live` and `/health`
to return 200 before uploads. Require a real native upload and canonical read
before calling Publisher usable. The local placeholder OAuth client cannot
prove authenticated pages. A local authorized OAuth client is a separate
prerequisite. Do not replace session authentication with a test cookie.

## Doctor

Run the following read-only check before a drive and after any unexpected result:

```sh
python3 .agents/skills/verify-tools/scripts/native-fixtures.py doctor   --state "$TOOLS_VERIFY_STATE"
```

It checks owned native processes, the database sentinel, storage health, and
Tools readiness. Record the Git revision and terminal handle with its output.
A healthy dependency does not prove a browser can reach the same origin.

## Drive

Run CLIs through `native-fixtures.py run --state "$TOOLS_VERIFY_STATE" --` so
only the owned fixture credentials reach the client. Run Fleet's source client
from its isolated checkout. Use T3 `preview_status`, `preview_open`, navigation,
and snapshots for browser actions. Prefer snapshot locators.

Follow the selected feature file. Capture the user action and its result.
Inspect real stored rows and raw bytes as a second view after upload mutations.
Protected HTML adds a favicon during delivery. Hash stored bytes separately.
Do not count a skipped real-resource suite or a mocked request as a live pass.

## Evidence

Keep commands, exit codes, redacted responses, browser captures, raw-byte
hash comparisons, and feature results under `.agents/artifacts/<run-id>/`.
Keep credentials and full capability URLs in the private state directory.
Record passed, failed, blocked, and unrun checks separately. Record local checks,
CI, review, merge, release, and Max's acceptance separately.

## Cleanup

Stop only the web terminal started by this run. Then run:

```sh
python3 .agents/skills/verify-tools/scripts/native-fixtures.py stop   --state "$TOOLS_VERIFY_STATE"
```

This stops only the native fixture processes identified by that state directory.
It keeps database files, bucket files, and evidence. Confirm the owned ports
are closed and the proof files still exist. Never kill by process name.

## Helpers

`native-fixtures.py start` initializes and starts fresh native fixtures.
`run -- <command>` supplies their environment without printing credentials.
`doctor` reads their state. `stop` stops them without deleting their data.
Run `native-fixtures.py --help` for the port and binary options.

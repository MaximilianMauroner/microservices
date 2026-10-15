# Native verification skill handoff

The skills now describe explicit native setup and the direct Publisher paths.
No fixture or browser process was started by this delegate. The parent owns
live PostgreSQL, RustFS, CLI, and browser verification after cherry-pick.

## Changes

- `verify-tools/scripts/native-fixtures.py` disables PostgreSQL Unix sockets.
  Every client already uses loopback TCP. This removes the Unix socket path
  length limit and avoids quoting a state path in PostgreSQL startup options.
  Storage PID checks request full command lines with `ps -ww`.
- `verify-tools/SKILL.md` uses `pg_config --bindir` and an explicit verified
  RustFS path. It gives native port defaults and the shared heavy-check lock.
- `verify-tools/features/publisher.md` replaces P4 multipart acceptance with
  real Fleet direct create, replacement, recovery, source integrity, and request
  observation. It adds PDF inline and explicit download checks. Storage now
  uses the helper's loopback endpoint. Browser reachability, CORS, OAuth, and
  PDF viewer blockers remain explicit. No session bypass was added.
- `verify-network-console/SKILL.md` uses the shared heavy-check lock for heavy
  checks. Its dashboard reference describes missing `ss` without a Mac assumption.

The existing owner metadata and environment dictionary remain the fixture data
model. No new lifecycle, storage abstraction, or configuration option was added.
Model the Domain kept that structure. Laziness Protocol limited the Python
change to startup, process inspection, and help text.

## Installed tools

Read-only inspection on this VM found Linux x86_64 and PostgreSQL 16.15.
`pg_config --bindir` returns `/usr/lib/postgresql/16/bin`. The `initdb`, `pg_ctl`,
`postgres`, `psql`, and `createdb` executables exist there. Native RustFS and
MinIO were absent from PATH and the usual local installation directories.
`curl`, `unzip`, `sha256sum`, `ss`, and `lsof` are installed.

There are pre-existing PostgreSQL processes. Do not reuse or stop them.
The helper checks its selected ports before setup. It creates a fresh owned
cluster and retained body directory.

The GitHub release API lists `rustfs-linux-x86_64-gnu-v1.0.1.zip` at the URL
below. Its official `SHA256SUMS` contains this digest:

```text
9742e183cb0dfb0d48fa909797af572fe47b7f827569036baa4156e0d3958ee5
```

## Parent startup commands

These commands are prepared, not executed. Run from the primary worktree after
cherry-pick. Save the private directory paths and exact terminal handles.
Do not commit downloaded binaries, fixture data, credentials, or capability URLs.

```sh
set -eu
umask 077
TOOLS_VERIFY_REPO=/home/codex/.t3/worktrees/microservices/fix-direct-uploads-tools-and-fleet-vm-20261016
cd "$TOOLS_VERIFY_REPO"
TOOLS_VERIFY_DEPS=$(mktemp -d /tmp/tools-native-deps.XXXXXX)
TOOLS_VERIFY_ARCHIVE=rustfs-linux-x86_64-gnu-v1.0.1.zip
curl --fail --location --retry 3 \
  "https://github.com/rustfs/rustfs/releases/download/1.0.1/$TOOLS_VERIFY_ARCHIVE" \
  --output "$TOOLS_VERIFY_DEPS/$TOOLS_VERIFY_ARCHIVE"
printf '%s  %s\n' \
  9742e183cb0dfb0d48fa909797af572fe47b7f827569036baa4156e0d3958ee5 \
  "$TOOLS_VERIFY_DEPS/$TOOLS_VERIFY_ARCHIVE" | sha256sum --check -
unzip -q "$TOOLS_VERIFY_DEPS/$TOOLS_VERIFY_ARCHIVE" -d "$TOOLS_VERIFY_DEPS"
TOOLS_VERIFY_S3_BIN="$TOOLS_VERIFY_DEPS/rustfs"
chmod u+x "$TOOLS_VERIFY_S3_BIN"
"$TOOLS_VERIFY_S3_BIN" --help
TOOLS_VERIFY_PG_BIN=$(pg_config --bindir)
"$TOOLS_VERIFY_PG_BIN/postgres" --version
TOOLS_VERIFY_STATE=$(mktemp -d /tmp/tools-verify.XXXXXX)
heavy-check --repo "$TOOLS_VERIFY_REPO" -- \
  python3 .agents/skills/verify-tools/scripts/native-fixtures.py start \
  --state "$TOOLS_VERIFY_STATE" --pg-bin "$TOOLS_VERIFY_PG_BIN" \
  --s3-bin "$TOOLS_VERIFY_S3_BIN"
```

Require successful setup before the web command. Start the web in its own owned
terminal. Retain that terminal handle for shutdown. If the build needs another
heavy command, stop this development process first to release the shared lock.

```sh
heavy-check --repo "$TOOLS_VERIFY_REPO" -- \
  python3 .agents/skills/verify-tools/scripts/native-fixtures.py run \
  --state "$TOOLS_VERIFY_STATE" -- pnpm --dir services/tools run dev \
  --host 127.0.0.1 --port 43171 --strictPort
```

In another terminal, restore `TOOLS_VERIFY_STATE` to the saved path, then run:

```sh
python3 .agents/skills/verify-tools/scripts/native-fixtures.py doctor \
  --state "$TOOLS_VERIFY_STATE"
```

Follow the Publisher feature reference for real source CLI commands. Keep all
heavy tests serialized through the same primary worktree lock. Stop the owned
web terminal before those tests if its dev command holds the lock.

After the drive, stop the exact owned web terminal. Then stop fixtures:

```sh
python3 .agents/skills/verify-tools/scripts/native-fixtures.py stop \
  --state "$TOOLS_VERIFY_STATE"
```

Confirm owned ports 43171, 45432, 49000, and 49001 are closed. Keep fixture data,
prior bodies, downloaded dependencies, and evidence. Do not delete directories.

## Verification

- Passed. Python syntax through `compile` without bytecode output.
- Passed. `native-fixtures.py --help` shows the action, port, and binary options.
- Passed. Both skill-creator `quick_validate.py` checks.
- Passed. Every local Markdown link in both skills resolves.
- Passed. PostgreSQL 16 accepts an empty `unix_socket_directories` value through
  its read-only `-C` command with `-D . -c config_file=/dev/null`. This command
  starts no server. Two earlier probes omitted the required config or data
  directory and failed before reading the setting.
- Passed. Linux `ps -ww -p <owned-shell-pid> -o stat= -o command=` returns its
  full command line.
- Passed. `git diff --check` and scoped deslop inspection.
- Unrun by instruction. Native fixture startup, CLI upload, and browser journeys.
- Pending parent. Independent review, CI, and product acceptance.
- Unrun. Deployment, PR creation, merge, and production changes.

No new tests were added. The changed setup commands require the parent's real
fixture run. Syntax, help, and validators do not prove fixture startup.

## Next action

Parent cherry-picks this commit, runs the startup commands, and exercises the
selected Publisher journeys. Parent owns independent review. No product decision
is open in this delegate's scope. The local OAuth prerequisite still owns any
blocked authenticated browser checks.

Dispatch ledger. In-thread implementation and validation under the parent's
explicit delegate brief. No further delegate or review was started.

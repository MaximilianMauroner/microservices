# Stale replacement journal repair

The repair transfers a confirmed stale or revoked legacy replacement from its
operation journal to a retained failed replacement session. The session insert
and journal deletion use one transaction after the conditional commit rolls
back. The session retains the operation UUID, staging ID, target ID, expected
object key, upload description, and digest.

The original writer receives the existing conflict error and HTTP 409. Shared
recovery treats that conflict as terminal and continues to later operations.
Other errors still propagate. Ambiguous old-format journals keep their existing
evidence and log behavior.

Existing direct-session cleanup owns the exact unpublished staged key. Its
published-key check protects canonical bytes. Failed cleanup retains the
session for retry. Replacement records remain reserved after cleanup and expiry.
The repair does not delete old version bytes.

The resource regression races a real direct replacement between the legacy
writer's version read and journal reservation. It covers the writer's HTTP 409,
an interrupted stale journal, and an interrupted revoked-target journal. It
checks unrelated reads, later recovery rows, retained metadata, cleanup failure,
restart and retry, immutable prior bytes, canonical metadata, and UUID reuse.

## Throughput checkpoint

The work stays in `postgres-storage.ts` and the Publisher integration test.
The existing retained replacement session is the cleanup owner. No schema,
generic recovery layer, client, helper, or app change is needed.

The parent owns resource execution, actual app checks, independent review, CI,
and final integration. This delegate starts no fixture and uses no nested agent.

## Checks

- Failed. Initial Publisher unit run. Eight files passed. Two files failed.
  There were 109 passed tests and nine failed tests. Six failures hit the
  default five-second timeout. Three subsequent chunk tests returned unexpected
  capacity or session results. Those may be effects of timed-out tests, but that
  cause is not proved.
- Failed. The retry on Node.js 22 with a 60-second test timeout passed 112 tests
  and failed six guest chunk tests. The tests use the VM's shared temporary
  directory for durable chunk sessions. This run did not isolate that state.
- Passed. The same 118 Publisher unit tests passed in all ten files with a fresh
  `TMPDIR` inside this worktree and the 60-second test timeout. No assertion or
  product setting changed. The temporary files remain uncommitted.
- Passed. Publisher typecheck through the shared `heavy-check` lock.
- Passed. `git diff --check`.
- Unrun by instruction. PostgreSQL and S3 regression. The parent must run it.
- Passed. In-thread comment and deslop review. No comments were added, and no
  new workaround, suppression, wrapper, or generic recovery layer was found.

The passing commands ran from this isolated worktree through
`heavy-check --repo /home/codex/.t3/worktrees/microservices/fix-direct-uploads-tools-and-fleet-vm-20261016 --`.

```sh
corepack pnpm --dir services/tools/publisher run typecheck
env TMPDIR=/home/codex/.t3/worktrees/microservices/t3-8b0c498d/.agents/artifacts/direct-upload-stale-journal-r2/unit-tmp-isolated PATH="/home/codex/.local/share/direct-upload-vm-20261016/deps/node-v22.23.3-linux-x64/bin:$PATH" corepack pnpm --dir services/tools/publisher exec vitest run --exclude test/direct-uploads.integration.test.ts --maxWorkers=1 --testTimeout=60000 --hookTimeout=60000
```

The parent can select the new resource cases with
`vitest run test/direct-uploads.integration.test.ts -t 'retains stale legacy staging ownership'`
after supplying its owned PostgreSQL and S3 fixture environment.

## Principles and scope

Model the Domain selected the existing failed replacement session and explicit
finalization outcomes. Fix Root Causes moved conflict handling into finalization
without a broad catch around shared recovery. Test Behavior, Not Implementation
selected HTTP responses, real stored bytes, durable metadata, and restart checks.
Laziness Protocol kept the change in the existing storage lifecycle.

The parent is responsible for the playbook and further review. Nested skill
delegation is omitted under the explicit no-nested-delegates instruction.

No production resource was accessed. No deployment, PR, or merge was performed.
Acceptance remains open with Max. The next action belongs to the parent, which
must apply the commit and run the owned resource regression.

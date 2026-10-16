**Microservices verdict: changes required.** Three warning findings. No critical finding.

### 1. [warning] Stale replacement recovery fails unrelated requests and forgets staged bytes

**Location:** [postgres-storage.ts:285](/home/codex/.t3/worktrees/microservices/fix-direct-uploads-tools-and-fleet-vm-20261016/services/tools/publisher/src/postgres-storage.ts:285), `reconcileOperation` at line 346.

**Finding:** A stale new-format legacy journal throws through shared recovery. Its staging key then loses its durable owner.

**Evidence:** A direct commit can win between the legacy writer’s current-version read and journal reservation. If that legacy writer stops after staging, recovery later calls `finalizePut`. The conditional commit rejects the stale expected key. The catch deletes the journal and throws `HtmlUpdateConflictError`. This escapes `reconcileArtifactOperations`, so an unrelated read returns 500 and later recovery rows wait for another request.

No receipt or upload-session row was created for the rejected staging key. Normal session cleanup cannot find it. Only a later explicit artifact revoke scans that prefix.

**Suggestion:** Treat a confirmed stale replacement as a terminal recovery outcome. Keep durable cleanup ownership until its unpublished staging key is removed. Return the conflict to the original writer without failing unrelated recovery.

### 2. [warning] Backup can report completion after an undetected source bucket write

**Location:** [release-paired-backup.mjs:317](/home/codex/.t3/worktrees/microservices/fix-direct-uploads-tools-and-fleet-vm-20261016/services/tools/publisher/scripts/release-paired-backup.mjs:317).

**Finding:** The checks do not establish the stated guarantee that source writes invalidate the backup.

**Evidence:** After the final bucket inventory at line 319, the helper performs another full database inventory and temporary-directory scan before writing `COMPLETE`. A bucket-only write during that interval changes neither the database comparison nor PostgreSQL WAL. The backup still returns `complete: true`.

Tag changes have another gap. During the second body scan, a tag change to an object already checked does not change its listing ETag or last-modified value. The final listing cannot detect it.

**Suggestion:** Require source quiescence and state the observation limit explicitly. A stronger “reject all source writes” claim needs independent write/version evidence. Add regressions for late bucket writes and tag changes during the second scan.

### 3. [warning] Source verification does not check source identity

**Location:** [release-paired-backup.mjs:439](/home/codex/.t3/worktrees/microservices/fix-direct-uploads-tools-and-fleet-vm-20261016/services/tools/publisher/scripts/release-paired-backup.mjs:439).

**Finding:** `verify --source` can verify a different resource while reporting that source verification passed.

**Evidence:** `verify` loads the manifest, then calls the same content comparison used for restored targets. It never compares the configured endpoint, bucket, database identity, or production resource UUID scope with `manifest.source`. A clone with matching rows and bodies passes. Different supplied production scope UUIDs are also ignored. This cannot prove that the original newer source survived restoration.

**Suggestion:** Distinguish source verification from restore verification. For source verification, check the recorded connection identity and resource scope before comparing content.

**Fleet verdict: no findings** in the fix from `354cf6d` through the working edits.

Inspection only. No files changed, tests run, processes started, or production calls made. CI, merge, and acceptance were not assessed.

Open decisions belong to the parent implementer. Resolve the Microservices findings, then run the owned-resource regressions and actual app proof.

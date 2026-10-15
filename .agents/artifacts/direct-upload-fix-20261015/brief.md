# Direct native upload implementation

Done requires reviewed code and linked draft PRs in Microservices and Fleet, real local CLI and browser evidence, required checks, and one concrete release procedure. Production and installed clients stay unchanged until Max approves the exact release actions.

Preserve commands, flags, buttons, canonical IDs and URLs, retained file bytes and metadata, source files, expiry, and auth boundaries. Native HTML create and replacement must use direct sessions. Keep working direct temporary uploads. PDF delivery must be inline where supported and offer an explicit download. HTML remains a protected webpage.

Model a direct operation as create or replace. A replacement owns a unique staging identity and immutable body key, plus the target ID and expected current version. Verify stored size and SHA-256 before an atomic conditional pointer commit. Preserve prior body and recovery metadata. Cancellation, expiry, duplicate completion, journal recovery, legacy writers, project changes, revoke and delete cannot resurrect or clobber content. Explicit revoke and cleanup must understand all owned keys. Keep replacement receipts needed by recovery.

Do not bulk move, rewrite, upload, rename or delete stored files. Do not enlarge limits. Keep historical readers. Remove legacy writes only when actual callers and local chunk sessions are accounted for. Max is the only uploader and can pause during release. No global pause framework or mandatory observation week. One release action may coordinate one Railway deployment and narrowly scoped Fleet distribution. Offline targets and unknown callers are real blockers, not migration proof. No claim of atomic rollback across machines.

Fleet source is /Users/maximilianmauroner/Documents/GitHub/fleet. Use an isolated checkout from current origin/main and leave main clean. Preserve request UUID recovery, retry bounds, source mutation checks, classification, project defaults, expiry, credential isolation, and digest checks. Do not use broad update-fleet --apply --device for a skill-only rollout.

Verification needs owned loopback PostgreSQL and S3, the disposable database sentinel and tools-transfer-test bucket. A skipped suite is not a pass. Test real Fleet CLI against isolated Tools, HTML create and replace, PDF browser and download, interrupted/repeated completion, stale/racing/revoked writes and restarts. Compare raw stored bytes independently of favicon injection. Trace upload bodies to storage rather than app requests. Run focused tests and typechecks, pnpm run verify, Tools build, Fleet validation and both upload test suites.

Release preparation must include a paired database and bucket backup with isolated restore verification, manifests, a local legacy-chunk drain/recovery proof, caller register, every declared Fleet device and harness destination, exact deployment and scoped distribution commands, and recovery that preserves newer writes and retained bodies. Do not deploy, merge, touch production data, distribute installed clients, change credentials or delete data.

## Workflow

1. Ground current source and capture baseline failures.
2. Compare two independent designs and select the smallest safe structure.
3. Implement server state and lifecycle in primary worktree. Implement Fleet client and narrow distribution in isolated Fleet worktree with disjoint ownership.
4. Verify each unit before integration. Run real-resource and CLI checks, then browser and full repository checks.
5. Resolve independent multi-model review findings. Open and link draft PRs.
6. Prepare one reviewable release action and request approval only after local work is complete.

## Throughput checkpoint

Blocking first steps. Fresh source, ownership, staged-key and conditional-commit design, baseline fixtures.
Independent workstreams. Server state and Fleet client use disjoint repositories after the wire contract is selected.
Shared mutable state. Immutable body keys isolate writers. PostgreSQL conditionally commits the one canonical pointer. Each delegate owns a separate checkout.
Smallest safe decomposition. One server owner keeps transaction, recovery and lifecycle invariants together. One Fleet owner owns client, tests, skill text and narrow distribution.

## Latest user direction

Do not use Docker. Replace the existing project verification skill with new skills through create-verification-skill. Use owned native local processes for any real-resource verification. Preserve stopped Docker volumes and evidence. Continue the original implementation and draft PR work after this verification change.

Execution verdict is PASS for the assigned native verification.

All 26 direct-upload integration tests passed. None failed or skipped. All 10 backup boundary tests passed. None failed, cancelled, or skipped. Both actual source CLIs passed against this checkout's built HTTP application. Five CLI operations and five independent stored-byte checks passed.

The integration suite used actual PostgreSQL 16.15 and native RustFS on owned loopback resources. Its application handlers ran in process. The CLI checks used the actual built HTTP server on port 43175. The integration suite retained its expected browser origin on port 43171. The CORS helper restored the actual application origin before the CLI checks.

The Prove It Works principle shaped this run. The verifier checked actual client output, completed native direct-upload sessions, PostgreSQL metadata, raw private storage bytes, and canonical HTTP reads. Static source inspection was not the acceptance evidence.

Passed checks follow.

- The owned build passed after the isolated source pin passed. The source pin also passed after the build and after the CLI operations.
- The full direct-upload resource suite passed 26 of 26 tests. See integration.log and integration.json.
- The backup boundary suite passed 10 of 10 tests. See backup-boundaries.log.
- The native doctor passed the database sentinel, native storage health, /live, and /health checks. See doctor.log.
- Fleet created persistent HTML with project final-native-proof. Raw bytes, size, SHA-256, the completed native session, and the canonical read matched.
- Fleet replaced that HTML from a separate source file. The ID, canonical URL, project, and creation time stayed equal. The object key changed. Current raw bytes matched the revised source. Prior raw bytes remained equal to the original source.
- Fleet uploaded a temporary binary file. Its raw bytes, size, SHA-256, native session, and canonical read matched.
- TypeScript uploaded HTML and a temporary binary file. Both raw-byte comparisons, sizes, SHA-256 values, native sessions, and canonical reads matched. This TypeScript CLI supports creation only.
- All five source fixtures remained present with unchanged SHA-256 values. Both client source files and the application source fingerprint remained unchanged.
- The private pre-stop archive completed before the owned processes stopped. The stopped archive contains all retained fixture data. All 2426 regular files in that archive matched the retained fixture byte for byte.
- The exact owned HTTP PID and RustFS PID are inactive. PostgreSQL has no postmaster PID file. Ports 45434, 49004, 49005, and 43175 have no listeners. See final-validation.json and stopped-listeners.txt.

Two setup failures remain in the record. Neither was counted as a pass.

- The retained driver forced NODE_ENV=production for the local HTTP origin. The first HTTP launch reported "PUBLIC_ORIGIN must be an HTTPS origin" and failed readiness. The fixture was archived and stopped. The same built application later passed with the native helper's documented NODE_ENV=development environment. See r5-driver.log, http-app.log, http-local-driver.log, and http-app-local.log.
- The first restart command omitted PostgreSQL's original options. PostgreSQL reported "could not bind IPv4 address "127.0.0.1": Address already in use" while it tried the default port 5432. It did not start. The corrected command used the original loopback options and port 45434. See fixture-pg-restart.first-attempt.log, http-retry-driver.log, and fixture-pg-restart.log.

All heavy work ran one command at a time through heavy-check with the required primary checkout lock and lock timeout of 3600 seconds. The process affinity included all six allowed CPUs. VITEST_MAX_WORKERS=1 bounded the integration workers. No source, test, or timeout changed. No filtered suite, broad test run, Docker, installed rollout, deployment, or production call ran.

Exact SHA-256 provenance follows.

- Application source fingerprint. a430b837c6aef31e966eaf708c4f4b1f25a6a2cb4cbd1e456044689779cb17d7.
- Built output tree. bbf8c426e66478fffeee9b3c50f2e848dc24a432b40aa586fbca434198b1cc1a.
- Built server entry. ecbd1a3f76402ff73357848523d3c2bc0cbc7cab930ba669ceb4a00895937893.
- /home/codex/.t3/worktrees/microservices/direct-upload-final-artifact-20261016/services/tools/publisher/scripts/upload-direct.ts. 22e7a26b83b0866655e4e1774ccde15d3ee475f42452e5c554f1d9d6b6b18904.
- /home/codex/.t3/worktrees/microservices/direct-upload-final-artifact-20261016/services/tools/publisher/test/direct-uploads.integration.test.ts. a1d98680d5377a19dcc7a8459fd245fe3cfc633755e36c6f0e8b85ea030e261e.
- /home/codex/.t3/worktrees/microservices/direct-upload-final-artifact-20261016/services/tools/publisher/scripts/release-paired-backup.test.mjs. 417a0f550fe10cfebd01a523a068fd0cba2d2b761507eef7de1acf0f644c36d3.
- /home/codex/.t3/worktrees/fleet/direct-html-uploads-vm-20261016/skills/file-upload/scripts/upload.py. f5566e1e192eacf4dc47231f43b367d9bbaaa682102250abe8d2b57dbb1b7dee.

The application source fingerprint hashes each sorted tracked or nonignored source path, a NUL byte, and its raw bytes under services/tools and the root package and workspace lock files. The build tree hash uses each sorted relative path, a NUL byte, and its raw bytes under services/tools/.output. It includes build-source-proof.json. build-manifest.json lists all 327 files and their individual checksums. provenance.json records the isolated checkout revision, Node version, CPU affinity, client source revision, and source checksums.

The evidence directory is /home/codex/.t3/worktrees/microservices/direct-upload-final-artifact-20261016/.agents/artifacts/final-native-verifier. The executable verifier files are drive.py, drive-http-retry.py, check-stored.mjs, and finish.py. Earlier failed driver variants remain retained. status.json records command outcomes. The driver files contain the exact commands and owned environment selection. CLI stdout, row snapshots, session snapshots, original sources, delivered bodies, and raw prior and current bodies remain private in the fixture archive.

The private archives are retained at these paths.

- /home/codex/.local/share/direct-upload-vm-20261016/final-native-verifier/http-local-pre-stop-fixture.tar. 95692800 bytes. SHA-256 4f54271cda5f67e936e08c79930cfad0684d9a680fc41f2edc062462d1bf3961.
- /home/codex/.local/share/direct-upload-vm-20261016/final-native-verifier/http-local-stopped-fixture.tar. 95825920 bytes. SHA-256 d85591f56142eda52c963e06d2fb03db315d30ea5b6816a2086341ec307b54cc.

Earlier attempt archives also remain in the same private archive directory. Nothing retained was deleted. The fixture remains at /dev/shm/direct-upload-final-verifier-20261016. The final archive is durable and does not depend on tmpfs survival.

This verifier changed only its own evidence and driver files, generated build output, and its owned fixture. Git status is clean. No commit was made.

Limits and ownership follow.

- Local checks passed within this assigned scope. The initial setup failures are retained above.
- CI was not run or inspected by this verifier.
- Source review was not performed by this verifier. The parent owns the separate review results.
- No PR was created or merged. Merge status is outside this verifier's scope.
- No production or installed rollout acceptance is claimed.
- Private browser acceptance could not run with the placeholder OAuth values. No session boundary was bypassed.
- The parent owns the deeper browser, actual client response-loss, process-restart, source-mutation, and paired-backup proof. This report does not claim those independent results.
- Max's acceptance remains open. The parent owns the next action, which is to combine this execution evidence with its remaining review and runtime proof.

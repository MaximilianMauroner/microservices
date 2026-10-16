# Direct upload verification and release status

Both fixes are in isolated branches with linked draft PRs.
Microservices is https://github.com/MaximilianMauroner/microservices/pull/58.
Fleet is https://github.com/MaximilianMauroner/fleet/pull/62.
Neither PR is approved for merge or release.

## Local evidence

| Check | Result | Evidence |
| --- | --- | --- |
| Full repository typechecks and tests | Passed on the final source. 754 passed and 56 skipped. The 26 default resource skips are not resource passes. | `verify-result.json`, `verify-logical-guard-final.log` |
| Final Tools build and backup boundaries | Passed on the final source. Source fingerprints stayed unchanged through all three final checks. | `final-checks-result.json`, `build-logical-guard-final.log`, `backup-boundaries-final.log` |
| Independent actual PostgreSQL 16 and RustFS tests | Passed. All 26 passed with zero skips. | `independent/integration.json`, `independent/report.md` |
| Independent backup boundary tests | Passed. All 10 passed with zero skips. | `independent/backup-boundaries.log` |
| Actual Fleet and TypeScript source CLIs | Passed against an isolated built HTTP app. Independent execution also passed. | `live-cli-result.json`, `independent/final-validation.json` |
| Response loss and actual app process restart | Passed. Original UUIDs and sources recovered. Duplicate completion returned the saved result. | `live-cli-result.json`, `ts-recovery-result.json` |
| Source mutation and stored bytes | Passed. Changed-source completion was rejected. Current and prior raw bytes matched. Local sources remain retained. | `live-cli.py`, `inspect.mjs`, `independent/report.md` |
| Client body route | Passed. 54 native requests had at most 193 body bytes. No fixture body reached a native upload request. | `live-cli-result.json`, `observe.py` |
| Protected HTML webpage | Passed in T3 preview with the revised heading. | `html-browser-result.json`, `html-webpage.png` |
| Typed and binary-classified PDF viewer | Passed in full Chromium 153. Both rendered pages were inspected. Explicit capability downloads matched the source hashes. | `browser-result.json`, `pdf-viewer-redacted.png`, `binaryPdf-viewer-redacted.png` |
| Authenticated Library Replace and Download | Blocked. An authorized local OAuth client and subject are absent. No session was forged. | `browser-result.json` |
| Fleet source checks | Passed. 30 upload, 8 root upload, and 31 scoped delivery and target-sync tests. One existing macOS case was skipped on Linux. Validation and narrow dry run passed. | Fleet `status.md` and `final-checks.log` |
| Paired backup and isolated restore | Passed after the logical guard repair. A 29-body snapshot restored. The newer 30-body source stayed intact. Historical journal and receipts, exact metadata and tags, nonempty and clone refusal, and concurrent writer rejection passed. | `paired-proof-result.json`, `paired-proof-provenance.json`, `paired-logical-guard.log` |
| Real local legacy chunk drain | Passed across an actual app process restart with the original session. Preflight blocked the partial chunk, then passed after completion. | `paired-proof.mjs`, `paired-proof-result.json` |
| Fresh independent helper execution | Passed. Fresh backup and restore, repeat target verification, and source verification all exited 0. Independent checks matched 5 bodies and 179 rows across 28 tables. All 10 boundaries passed. | `independent-helper-r7/report.md`, `independent-helper-r7/status.json` |
| Primary fixture retention and shutdown | Passed. All 3,043 regular files in the stopped durable archive matched the retained fixture. All five owned ports closed. | `archive-proof.json`, `retain-fixtures.py` |

The complete source fingerprint includes the release helper.
The helper-only fixes do not change the application routes or CLI sources used
by the runtime proofs. Final helper checks and the final repository checks must
record their own source identity.

## Review and delivery

Opus and Sol reviewed the application and Fleet changes. Accepted correctness
findings were repaired. Reviews and dispositions remain in `review-*.md` and
`decisions.tsv`. Fresh Opus and Sol reviews found no correctness issue in the
backup repair.
The independent decision-trail audits are `trail-audit-final/report.md` and
`trail-audit-r7.md`. `audit-disposition-r7.md` records the final dispositions.

No repository CI workflow exists, and both PR check rollups were empty at the
recorded readback. Local checks do not represent hosted CI.
Both PRs remain draft. Merge, backend deployment, installed distribution, and
Max's acceptance have not run.

Every declared Fleet destination is separate and remains pending.

| Device | Destination | Status |
| --- | --- | --- |
| MacBook Air | Canonical `.agents/skills/file-upload` | Pending. Installed state unobserved. |
| MacBook Air | Codex `.codex/skills/file-upload` | Pending. Installed state unobserved. |
| MacBook Air | Claude `.claude/skills/file-upload` | Pending. Installed state unobserved. |
| MacBook Air | Claude `.claude_cliproxy/skills/file-upload` | Pending. Installed state unobserved. |
| Coding VM | Canonical `.agents/skills/file-upload` | Pending. Older installed source observed. |
| Coding VM | Codex `.codex/skills/file-upload` | Pending. Older installed source observed. |
| Coding VM | Codex `.codex-pooled/skills/file-upload` | Pending. Older installed source observed. |
| Coding VM | Claude `.claude/skills/file-upload` | Pending. Older installed source observed. |
| Coding VM | Claude `.claude_cliproxy/skills/file-upload` | Pending. Older installed source observed. |
| Home PC | Canonical `.agents/skills/file-upload` | Pending. Installed state unobserved. |
| Home PC | Codex `.codex/skills/file-upload` | Pending. Installed state unobserved. |
| Home PC | Claude `.claude/skills/file-upload` | Pending. Installed state unobserved. |

Fleet `destinations.json` records the full paths, source hashes, link targets,
and observation limits. Unknown and offline callers block legacy removal.
The fixed legacy writers and historical readers remain available.

## Open acceptance and release actions

Max owns authorized local OAuth setup and acceptance of Library Replace and
Download. Max also owns acceptance of the retained replacement retry policy.
A failed or expired replacement keeps its UUID. A later same-file retry can
need a new tab. No automatic request rebinding occurs.

The continuation owner completed the helper proof, independent reviews, and
fixture retention. All 3,883 regular files in the independent verifier's stopped
archive also matched. Its owned ports are closed. Both reviewed draft descriptions and heads were published and read back.
T3 lists both PRs as open drafts. The final decision-trail audit completed with
no new correctness blocker. Its dispositions are published with the evidence.
Max owns later production approval of `release.md` and the paired Fleet
procedure. That action has one backend trigger, then scoped file-upload
distribution from the MacBook Air. Production instance inventory, chunk drain,
matching pg_dump, verified CA, paired backup, and isolated recovery remain
preconditions of that approved action. No production data command ran locally.

Raw execution logs and the retained reproduction patch keep their original
whitespace. The broad artifact whitespace check reports that recorded output.
Application source and operator-document whitespace checks passed.

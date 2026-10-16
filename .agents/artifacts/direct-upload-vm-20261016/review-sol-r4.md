**No remaining findings in this scope.**

- **R1 dismissal is valid.** The unique index on non-null `artifact_id` exists in both `origin/main` and current source. The retained reproduction fails on the second insert with `23505`, before recovery runs. The claimed mutual blocking requires a state the schema prevents.
- **Helper delta: no findings.** The host guard now requires deployment and replica IDs. Preflight and backup metadata record both IDs and hostname. Production restore remains prohibited.

Inspection only. No files changed, tests or services started, or production calls made.

Verification remains open: the prior resource run **failed, 20 passed and 6 failed**. The current rerun has no established result here. App, CLI, PDF, and paired recovery proof remain pending. CI, merge, and acceptance were not assessed.

Parent owns the next action: record the rerun result and complete the pending proof. No new code decision is required.

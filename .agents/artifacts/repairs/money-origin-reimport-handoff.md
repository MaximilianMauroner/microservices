# Money transfer origin repair

The repair is ready for parent review and execution. Runtime correctness is not yet verified.

## Checkout and scope

The worktree is `/home/codex/.t3/worktrees/microservices/t3-7d78e819`.
The branch is `fix/money-origin-reimport-1`. It starts at the specified R1 head `3f46841`.
Only the Money changes from candidate commits `cbf3933` and `f6af5dc` were reused. Their branch and its runtime or Actions ancestry were not merged.

Changed source paths are:

- `services/tools/database/postgres-schema.ts`.
- `services/tools/money/money-repository.ts`.
- `services/tools/test/money-repository.integration.test.ts`.
- `services/tools/money/money-ledger-views.tsx`.

This handoff and `money-origin-reimport-decisions.tsv` are the only other changed paths.

## Cause and repair

The supplied R1 PostgreSQL log reports 30 executed cases, 28 passed, two failed, and no skipped cases.
Its stored-rule case expected `internal_transfer` and received `spend` after reimport.
Reimport kept every disposition. Inference selected only rows with no disposition, so a new rule could not change an old automatic result.

The other failing test expected a rebuild to erase manual categories and transfer choices.
That fixture conflicts with the manual-preservation contract supplied in the brief.
It now has separate automatic-rebuild and manual-preservation cases.
The stored-rule refresh assertion remains unchanged.

The nullable `transfer_origin` field contains `automatic`, `manual`, or null.
The schema has no default or backfill. Old rows remain unknown.
Inference records automatic origin. Single and bulk review record manual origin.
Confirming an existing pair records both members as manual, even when the value stays `internal_transfer`.
Splitting a pair records the chosen row as manual and clears the counterpart's group, disposition, and origin.
Import deletion clears the broken group's origin with its other transfer fields before normal inference runs.

Rebuild clears only known automatic single rows and groups whose members are all automatic.
It preserves each whole group that contains a manual or unknown member.
The existing linker then applies current rules to unresolved rows.
If the same pair links again, the repair restores its old group ID.

## Coverage

The new automatic fixture imports two counterparts separately, then rebuilds them into one pair.
It checks row IDs, source keys, import ownership, pair ID, and counts across repeated rebuilds.
The manual fixture reads stored categories and origins directly, including a manual category on an automatic pair.
It also covers a manual category equal to the automatic value and a manual refund equal to the previous automatic value.
Activity mapping cannot hide a category or origin reset in these assertions.

Other cases cover inference origins, unknown legacy singles and pairs, automatic/manual and automatic/unknown mixed groups, pair confirmation, splitting, deletion, bulk review, rule removal and replay, repeated rebuilds, and both lock orders for review against reimport.
Static inspection counts 43 expanded integration cases. Execution must confirm that count and report zero skips.

## Checks and limits

- PASSED. Node v24.21.0 syntax checks with `node --experimental-strip-types --check` for the schema, repository, and integration test.
- PASSED. `git diff --check`.
- PASSED. In-thread deslop review of the owned diff. No speculative paths or new comments were added.
- BLOCKED by task limits. PostgreSQL tests, service tests, typecheck, and browser checks were not run. This checkout has no installed dependencies. No installs, heavy checks, or servers were started.
- BLOCKED pending parent work. Independent review and real runtime verification.
- CI was not started. No PR was opened. No push or merge occurred. Max acceptance remains pending.
- No production data, deployment, or external configuration was changed.

Parent verification should run the focused Money PostgreSQL suite through the owned R1 runtime runner, then the service typecheck and required checks. The exact integration artifact must show all cases executed with no skips.
The syntax checks do not validate SQL behavior or TypeScript types.

## Decisions and next action

Model the Domain shaped the nullable origin field. The code records who made the decision instead of inferring origin from its value.

The throughput checkpoint kept source diagnosis first, then one coupled implementation in this isolated checkout.
There was no independent implementation stream because the task forbids descendants.
The existing category-rule lock continues to serialize Money writes.
Parent-owned heavy checks and review remain separate from this delegate.

This R1 tree has one explicit manual-reset promise. The two text changes are the confirmation description and the progress description in `money-ledger-views.tsx`.
The parent was informed of that interpretation. There are no open product questions.

The parent owns review, PostgreSQL execution, typecheck, and integration into R1.
Its next action is to review this branch and run the queued checks before integration.

Dispatch ledger. Implementation, source diagnosis, design, and deslop stayed in-thread because descendants are forbidden. Runtime verification and independent review stay with the parent.

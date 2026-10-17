# R4 implementation handoff

R4 source and real PostgreSQL regression tests are written. Runtime verification is pending with the parent. No execution pass is claimed.

## Scope

All commands ran in `/home/codex/.t3/worktrees/microservices/fix-agent-mistakes-r4-ledger` on `refactor/agent-mistakes-r4-ledger`.

Changed files are the following.

- `services/tools/money/money-ledger-sql.ts` owns the unchanged effective-row filter and the new derived contribution relation. Each row has its effective treatment, signed category spending, income, fees, and tax. The relation is SQL only.
- `services/tools/money/money-repository.ts` uses that relation for category totals, category months, merchant months, and `readSpendingSince`. Monthly cash flow and cash-account flow queries retain their existing rules.
- `services/tools/money/money-market-data-repository.ts` imports the effective-row filter from its new owner. Its queries are unchanged.
- `services/tools/test/money-ledger-contributions.integration.test.ts` adds three real PostgreSQL cases. The fixtures pass through `parseMoneyImport` and `commitImport`. Transfer and category decisions use product operations.
- `services/tools/vitest.postgres.config.ts` includes the new test file in the required PostgreSQL suite.
- `services/tools/vitest.config.ts` excludes that exact integration file from the default unit suite.

`money-repository.integration.test.ts` was not edited. R3 owns it. No schema, stored projection, cache, public API, financial policy, or shared package was added.

## Test contract

The released-authorization case keeps the later completed charge in activity, category totals, category months, merchant months, check-in spending, and monthly cash flow. It asserts the completed date used by the parsed export.

The refund case covers a card refund, a shared repayment, a negative refund correction, a refund with negative net category spend, a positive transfer marked as spending, income, excluded and unreviewed transfers, and a matched internal transfer pair. It compares each category across category totals, category months, merchant months, and check-in spending. Expected net spending is 1,900 minor units. Fees are 375, tax is 400, income is 21,000, and monthly net cash flow is 18,325. Cash-account spending includes the costs and is -2,675. These are written expectations, not measured results.

The coverage case keeps current-month spending in all-time categories and check-in spending. Historical category months and merchant months exclude the current month. An intervening empty month is unobserved. A fee-only month is observed. A later transfer without costs does not extend monthly coverage. `readSpendingSince` retains its strict date boundary.

All new fixture writes follow a sentinel-verified cleanup. The new integration file fails in `beforeAll` when its required fixture environment is absent. The runner can discover the cases before it creates the fixture. It has no skipped-test fallback. Deliberate raw-storage tests remain in the existing integration file.

## Checks and limits

- Passed. `git diff --check` before commit.
- Passed. A Python source comparison against the starting HEAD confirmed that `effectiveTransactions` is unchanged, `monthlyCashFlow` is unchanged, and market data has only the import change.
- Passed. The same comparison confirmed that the R3 integration file was unchanged and that four matching consumers call `ledgerContributions`.
- Passed. Static runner review confirmed that discovery imports the test before fixture creation. Fixture setup therefore runs in `beforeAll`, which permits discovery and fails execution when fixture settings are absent.
- Passed. Manual deslop review of the scoped diff. No new wrappers, compatibility paths, type escapes, or extra fallback logic were introduced.
- Blocked for this child. Focused unit tests, Tools typecheck, and PostgreSQL execution. Dependencies were absent in this worktree. The parent owns the queued install and all actual checks. This child did not install dependencies or run heavy commands.
- Pending with the parent. PostgreSQL equivalence, historical red controls, full `pnpm run verify`, browser acceptance, and performance evidence from the approved plan.
- Pending with the parent. Independent source review. No descendant was spawned because the user prohibited it.
- CI was not started. No PR was created or pushed. No merge was performed. Max acceptance is pending.

`check-source.py` repeats the source comparison after the R4 commit. Run it from the repository root with `python3 .agents/artifacts/r4-ledger-2026-10-17/check-source.py` before the parent merges R3 into R4. Its `HEAD~1` base assumes this single R4 implementation commit.

## Parent checks

After dependencies are ready, run the focused service tests and typecheck through the parent's serialized `heavy-check` lane. Use the owned runtime runner for PostgreSQL.

```sh
heavy-check pnpm --dir services/tools exec vitest run test/money-repository-scope.test.ts test/money-import.test.ts test/money-market-data.test.ts test/money-checkin-domain.test.ts
heavy-check pnpm --dir services/tools run typecheck
heavy-check pnpm --dir services/tools run test:money-postgres
```

The PostgreSQL command must run with inherited database and storage endpoints unset, as required by the existing runner. Do not supply a production endpoint. Preserve the required runner receipts and report each scenario's actual result. No database, production setting, deployment, Actions workflow, external publication, or foreign process was touched by this child.

## Decisions and next action

The architecture is the approved R4 shape. No new architecture decision is open. Parent owns the R3 merge, actual checks, review, and publication. The next action is to run the focused and PostgreSQL checks once the parent's dependency install completes. Max owns final acceptance and any main-merge approval.

## Skill choices

Model the Domain put repeated financial expressions in the derived row. Laziness Protocol limited migration to the four matching consumers. Test Behavior, Not Implementation kept the regression assertions at the repository operations used by consumers. The approved plan and the user's instructions superseded new design exploration, descendant reviews, and runtime checks in this child.

Dispatch ledger follows.

- How and architecture ran in-thread from the settled plan and scoped source reads. The user prohibited descendants and requested no new design exploration.
- Mechanical edits and test writing ran in-thread under the assigned ownership.
- Independent review and runtime verification remain parent-owned. No child review or execution verdict is claimed.

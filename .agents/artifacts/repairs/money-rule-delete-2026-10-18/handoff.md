# Transfer rule deletion repair

`deleteTransferRule` now takes the shared rule lock before it deletes a rule.
The change is committed on `fix/money-reimport-provenance`.
Runtime verification remains with the parent.

The reported defect is [PR 69, discussion r4305055657](https://github.com/MaximilianMauroner/microservices/pull/69#discussion_r4305055657).

## Source change

`services/tools/money/money-repository.ts` wraps deletion in `sql.begin` and
takes `lockCategoryRules(tx)` before the delete statement.
This uses the same lock order as `reimportAll` and other Money writers.
Deletion still returns whether it removed a rule.
It keeps existing classifications until a later reimport.
The change adds no provenance inference for legacy rows.

## Regression

`services/tools/test/money-repository.integration.test.ts` adds two real
PostgreSQL cases through the existing `inCategoryRuleLockOrder` helper.
The helper holds the shared rule lock and checks `pg_locks` before it starts
the next writer. It releases the lock only after both writers have queued.
The order depends on observed lock requests, not a fixed delay.

Both cases create an excluded automatic transfer through the repository API.
They check the deleted rule, stored disposition and origin, rule preview,
and review counts.

- When deletion runs first, reimport leaves the transfer unresolved with a
  null origin. The review shows one unresolved outflow.
- When reimport runs first, deletion keeps the excluded automatic decision.
  The review shows no unresolved outflow until the next reimport.

Both cases check that a later reimport leaves the transfer unresolved.
All existing 43 cases and their assertions remain byte-for-byte unchanged.
The suite now defines 45 cases.

The inferred pre-fix failure is that deletion does not queue on the shared
lock, so the helper cannot establish the requested order.
This failure has not been run or observed in this task.

## Checks

- Passed. `node --experimental-strip-types --check services/tools/money/money-repository.ts`.
- Passed. `node --experimental-strip-types --check services/tools/test/money-repository.integration.test.ts`.
- Passed. `git diff --check`.
- Passed. A dependency-free text comparison removed the added test block and
  recovered the original test file exactly. A static count confirmed 43
  original cases and 45 total cases.
- Passed. Own diff review and deslop review found no extra abstractions,
  comments, dependency changes, or changes outside the allowed paths.
- Blocked by task scope. Real PostgreSQL execution, typecheck, build, and
  dependency commands belong to the parent. Syntax checks do not prove types
  or runtime behavior.
- Blocked by task scope. No independent review ran because descendants are
  prohibited. This handoff does not claim independent approval.
- CI was not run. No PR was written, pushed, or merged. Max has not accepted
  this repair.

No production data, credentials, service settings, or deployments were used.

## Parent verification

Use an isolated disposable PostgreSQL database with the guarded Tools schema
and sentinel already applied. Export its `TEST_DATABASE_URL` in the parent
shell. Do not use a database that has another writer.

Run the focused regression from the repository root.

```bash
MONEY_TEST_DATABASE_CONFIRM=money-repository-test pnpm --dir services/tools run test:money-postgres --testNamePattern='serializes transfer rule deletion with a reimport' --testTimeout=15000
```

Then run the complete Money integration suite.

```bash
MONEY_TEST_DATABASE_CONFIRM=money-repository-test pnpm --dir services/tools run test:money-postgres --testTimeout=15000
```

The longer timeout lets the lock helper report a missing queued writer if the
parent checks the regression against the original source.
Expected results are two passing focused cases and 45 passing suite cases.
Neither result is claimed here.

## Skill choices and next action

Model the Domain kept the existing rule and transfer provenance fields.
Laziness Protocol kept the fix to the existing transaction and lock helper.
Test Behavior, Not Implementation added assertions on stored and public review
results as well as the lock-order setup.

The Bug fix playbook ran in-thread under the explicit implementation scope.
No descendants ran. Runtime reproduction and verification remain open with
the parent. PR work and merge approval remain outside this task.

The parent owns the next action. Run the real PostgreSQL regression and suite,
then decide whether this branch is ready to integrate.

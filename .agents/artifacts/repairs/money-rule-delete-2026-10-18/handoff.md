# Transfer rule deletion repair

`inCategoryRuleLockOrder` now handles writer rejections at launch and drains
all started writers after the blocker transaction exits. The helper cannot
report success while a started writer is still pending.
Runtime verification remains with the parent.

The reported production defect is [PR 69, discussion r4305055657](https://github.com/MaximilianMauroner/microservices/pull/69#discussion_r4305055657).

## Accepted source

The parent accepts the existing `deleteTransferRule` transaction and lock,
and the two deletion-order regression cases, as static source.
This fix changes none of that source or its assertions.

Deletion takes `lockCategoryRules(tx)` before it deletes the rule.
It keeps existing classifications until a later reimport.
The two cases verify both serialization orders through stored state, rule
preview, and review counts. A later reimport leaves the transfer unresolved.

## Helper repair

Two independent reviewers reported the same warning on the prior helper.
A writer could reject without a handler. A polling failure also skipped the
final writer wait after `admin.begin` rejected.

The helper keeps the existing list of started promises and adds a local list
of rejection reasons. Each writer gets a rejection handler in the expression
that starts it. The handler records the original reason, including `undefined`.
The handled promise settles only when that writer settles.

The polling loop throws a recorded writer failure before it reaches the
missing-writer limit. A synchronous operation throw or a polling error also
exits the transaction callback. `admin.begin` commits or rolls back before
its promise settles, so the blocker releases before the `finally` drain.

`finally` waits for every started, handled promise. A secondary writer failure
cannot interrupt that drain or replace an error already leaving `admin.begin`.
After a successful blocker transaction, the helper throws the first recorded
writer failure. Operation errors cannot turn the helper result into success.
If several failures occur, the blocker failure has priority. With no blocker
failure, the first observed writer rejection has priority.

## Cleanup bounds

The existing polling bound remains 500 ten-millisecond delays per writer,
plus query time and a final count query. Current callers start two writers.
An early writer rejection is checked on the next poll with an incomplete queue.

On failure, the helper releases its own lock before it drains writers.
In the isolated disposable database required by this suite, no unrelated
writer holds that lock. The remaining repository transactions execute finite
SQL work after release. The drain has no dependency on the blocker it released.
No timer, cancellation helper, or detached race is needed for this failure.

This is a structural bound under the suite's database assumptions, not an
absolute wall-clock limit for a failed database or network. The helper adds
no SQL statement timeout. The existing polling count also cannot bound a
query that never returns. A timer that returned early would leave a writer
running and would not satisfy the cleanup requirement.

## Checks for this fix

- Passed. `node --experimental-strip-types --check services/tools/test/money-repository.integration.test.ts`.
- Passed. `git diff --check`.
- Passed. Static comparison against the assigned HEAD confirms that only
  `inCategoryRuleLockOrder` changed in the test file. All 45 cases and their
  outcome assertions remain byte-for-byte unchanged.
- Passed. Own diff review and deslop review found no added comments,
  abstractions, dependencies, or changes outside the two allowed paths.
- Blocked by task scope. Real PostgreSQL tests, typecheck, build, and all
  heavy commands remain with the parent. Syntax checks prove no runtime result.
- Blocked by task scope. No independent review of this fix ran. The two prior
  reviewers' warning is the input to this repair, not approval of this diff.
- CI was not run. No PR was written, pushed, or merged. Max has not accepted
  this repair.

No production data, credentials, service settings, or deployments were used.

## Parent verification

Use an isolated disposable PostgreSQL database with the guarded Tools schema
and sentinel already applied. The parent owns runtime commands and runs
heavy commands through `heavy-check`.

Run the focused deletion regression and then the full Money suite with their
normal timeouts. Expected results are two and 45 passing cases respectively.
Neither result is claimed here. Use the explicit 15000 ms timeout only in the
old-source proof checkout, where the missing-writer poll must finish first.

A minimal additional proof can use the actual helper in a temporary local
PostgreSQL case. Start a real reimport first and let it queue. Make the second
operation reject with a unique error before it requests the lock. Record when
the reimport settles. Verify that the helper rejects with that same error,
the reimport has settled before the helper returns, and no unhandled
rejection occurs. Then verify the reimport's stored outcome. Remove the
probe after the run so the committed suite retains its 45 cases.

To check polling failure priority, temporarily make `queued` throw a unique
error after a real writer has queued. Verify the same drain and error identity.
These probes exercise the actual helper and PostgreSQL ownership. They do
not need a copied helper, mocked transaction, or implementation-mirror test.
Neither probe ran in this assignment.

## Skill choices and next action

Model the Domain keeps rejection reasons in a local collection, so an error
value of `undefined` cannot look like success. Laziness Protocol keeps the
existing SQL owner and polling bound instead of adding timers or helpers.
Test Behavior, Not Implementation preserves all stored-state assertions and
keeps proposed failure probes on the actual helper and database.

The Bug fix playbook ran in-thread within the explicit implementation scope.
No descendants ran. Reproduction, runtime verification, and independent review
remain with the parent. PR work and merge approval remain outside this task.

The parent owns the open runtime and review decisions. Run the suite and the
failure probes, obtain review of this diff, then decide whether to integrate.

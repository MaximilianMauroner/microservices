# R6 implementation handoff

R6 is incomplete and is not ready to merge. This branch adds required built-app checks and named receipts. Real runtime execution has not run. Private OAuth acceptance and historical built-app replay still need implementation and execution.

## Scope and choices

All changes belong to `test/agent-mistakes-r6-runtime-journeys` in its assigned worktree. The initial uncommitted helper separation was accepted as assigned work. No other worktree was changed.

`createPlatformHandler` now lives in `services/tools/test/platform-handler.ts`. `test/app.test.ts` uses that helper. Production `authenticatePlatformRequest`, `toolsPrincipalAuthentication`, `PrincipalResolver`, `MountedService`, and `PlatformServices` remain in `src/app.ts`. Production callers in `start.ts` and `runtime.ts` retain their authentication boundary.

The new `vitest.journeys.config.ts` runs `test/runtime/journeys.test.ts` and the existing `test/status-links.test.tsx`. The fast suite excludes only the built-app journey file. The runtime runner discovers both required journey cases and the exact mounted Status regression. Removing that regression from discovery must fail.

The HTTP checks use the origin and native token from an owned `withLocalStack` callback. That helper builds Tools and starts `.output/server/index.mjs`. The tests check anonymous private navigation, anonymous upload-link POST with and without the native token, native upload-token denial and admission to input validation, and missing public upload capabilities. They do not import the test handler or mint sessions.

The runner adds a second owned stack for the journey suite after identity contracts. Each stack retains the existing bounded lifecycle and cleanup. This costs another build. No timing claim exists. Reuse can be considered after the focused checks pass, if the extra build violates the stated runtime budget.

Named `CheckReceipt` records contain suite, scenario, revision, fixture, result, and evidence. The revision comes from the existing Git probe. The fixture is the owned stack project. Executed records link the actual child report. An unrun record is blocked. Missing or skipped required observations fail aggregation. Blocked tests return nonzero. Only a complete report with blocked prerequisites, a natural child exit of one, released process ownership, and a written log can classify the journey step as blocked rather than failed.

`run.ts` refuses `--default-monitor-targets` before verification starts. No checker is started. The heartbeat-publication case is always blocked. HTTP 204 is never publication proof.

## Changed files

- `services/tools/src/app.ts` retains production authentication and removes the test composition helper.
- `services/tools/test/platform-handler.ts` owns that helper.
- `services/tools/test/app.test.ts` imports the test helper.
- `services/tools/test/runtime/journeys.test.ts` owns built-app HTTP checks and explicit acceptance blockers.
- `services/tools/test/runtime/receipt.ts` owns named journey identities, receipts, and the blocked result type.
- `services/tools/test/runtime/receipt.test.ts` checks missing and blocked required proof.
- `services/tools/test/runtime/vitest-child.ts` discovers the journey config and reports blocked cases.
- `services/tools/test/runtime/vitest-child.test.ts` checks that reporter behavior through a real child entry.
- `services/tools/test/runtime/verification.ts` adds required discovery, owned stack execution, and named receipts.
- `services/tools/test/runtime/verification.test.ts` checks the runner with synthetic reports. Those reports are unit fixtures only.
- `services/tools/test/runtime/run.ts` refuses default monitor targets.
- `services/tools/vitest.config.ts` excludes built journeys from the fast suite.
- `services/tools/vitest.journeys.config.ts` requires built journeys and mounted Status.
- This handoff records decisions, checks, and open work.

## Evidence read

- The R6 section and appendices in `/home/codex/work/microservices/.agents/artifacts/repo-correction-plan-2026-10-15/plan.md` require built-entry, mounted Status, historical replay, and real OAuth proof.
- The historical stack `final-stack-status.md` and `RESUME.md` report R6 as unstarted. They supply no R6 runtime pass.
- The historical stack `tools-runtime-ddl-how.md` records the distinction between local fixture resources and production ownership. No production connection was made here.
- Git shows that `98f7ca5^` has method-only upload-link handlers. `98f7ca5` adds POST middleware. These are replay targets, not executed negative and positive controls.
- The existing mounted Status regression comes from `9601243`. Its mounted anchors and empty console-error assertion are retained unchanged.

## Verification status

- PASSED. Node 24 parsed the 13 changed TypeScript files after type stripping. `SourceTextModule` parsed the result without linking or evaluating imports.
- PASSED. `git diff --check` found no whitespace errors.
- PASSED. Source search found `createPlatformHandler` only in its test helper and test callers. Production authentication remains in `src/app.ts`. This is a source-boundary check, not runtime proof.
- UNRUN. Focused Vitest cases, import loading, typecheck, production build, owned PostgreSQL, Docker, storage, built-app HTTP requests, mounted Status, browser acceptance, and `pnpm run verify`.
- UNRUN. Performance baseline and runtime budget checks.
- UNRUN. Independent code review. No descendants were authorized. The parent owns the review gate. The in-thread diff cleanup is not an independent verdict.
- UNRUN. CI. No Actions were started.
- NOT CREATED. PR. No push or merge occurred.
- PENDING. Max acceptance.

The synthetic child reports in `verification.test.ts` test runner rejection and lifecycle behavior only. They are not acceptance receipts for Tools. No report from that fixture is proof of an HTTP request or browser login.

## Parent verification queue

Run these commands serially through the parent's heavy-check queue. These are requested checks, not executed results.

1. Run `heavy-check --repo . -- pnpm --dir services/tools exec vitest run test/app.test.ts test/start.test.ts test/route-ownership.test.ts test/status-links.test.tsx test/runtime/receipt.test.ts test/runtime/verification.test.ts test/runtime/vitest-child.test.ts`.
2. Run `heavy-check --repo . -- pnpm --dir services/tools run typecheck`.
3. Run journey discovery with `heavy-check --repo . -- node --experimental-strip-types services/tools/test/runtime/vitest-child.ts discover /absolute/private/r6-discover.json journeys`. Confirm the mounted Status identity matches the registry exactly. Discovery must not run the beforeAll stack prerequisite.
4. After R2 and R3 propagation, run `heavy-check --repo . -- pnpm run verify`. Use only owned local data. The current accepted result cannot be PASS because the browser and historical acceptance cases deliberately block. Inspect `journeys-required.json`, `journeys-run-report.json`, and `receipts.json`. A setup failure can stop before journey execution. It must remain nonzero.
5. Run `heavy-check --repo . -- node --experimental-strip-types services/tools/test/runtime/run.ts workspace --default-monitor-targets`. Confirm nonzero refusal and no checker start.
6. Inspect owned process release and retained data after each actual stack run. Do not delete retained volumes.

## Remaining work and owners

The parent owns integration, focused execution, type fixes, and independent review. The new reporter classification and CLI fixture changes have only syntax evidence. They need the focused tests before reuse.

Max owns the real local Google OAuth client and allowed subject prerequisite. The owned local stack currently uses placeholders and cannot complete that login. No permission request is pending while Max sleeps. The parent must add an authorized browser execution path. It must verify login, a same-origin upload-link POST returning 201 JSON, a usable guest URL in a clean profile, and a cross-origin mutation with no state change. The two current private cases are explicit blocked placeholders. Supplying environment variables alone does not make them executable acceptance.

The parent owns a real historical replay driver. The current historical case is an explicit blocked placeholder, not a replay implementation. Build separately owned local stacks from `98f7ca5^` and `98f7ca5`, then exercise the same permitted upload-link POST with real local Google OAuth at each revision. Record the observed historical failure and corrected 201 JSON. Do not edit the active implementation worktree during replay. A handler call or source check cannot replace the built HTTP observation.

The checker fixture is outside R6. Heartbeat publication remains blocked until a separately scoped bounded checker has explicit local monitors, canonical pause state, and notifications disabled. No default monitors may run.

The parent owns any later AGENTS, README, or verification-skill updates. None was changed here because the required executable acceptance is incomplete.

## Decision trail and principles

Blocking first steps were the plan, service docs, existing runner, and historical route review. One owner held the coupled runner, reporter, config, and tests. There was no independent write stream inside this slice. Shared worktree writes were excluded by the assignment.

Model the Domain shaped the `CheckReceipt` type, required scenario registry, and explicit blocked case result. Test Behavior, Not Implementation shaped the HTTP assertions against the owned built server. Prove It Works prevented syntax checks, source searches, synthetic reports, and blocked placeholders from becoming acceptance passes.

The implementation and cleanup ran in-thread because this task explicitly forbade descendants. The parent must supply independent review and runtime verification. No Anthropic or claudeAgent role was used.

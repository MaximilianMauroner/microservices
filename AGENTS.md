# Agent instructions

This repository contains independently deployed services and the integrated
Mauroner Tools application.

## Read first

- Read `README.md`, `docs/tools-platform/README.md`, and
  `docs/tools-platform/runtime-boundaries.md` before you change routes,
  authentication, storage ownership, deployment, scheduling, or recovery.
- Read the nearest service README, tests, and package scripts before you change
  a service.

## Ownership

- Repository location defines runtime ownership.
- `services/tools` is one TanStack Start application. Its products share
  authentication, lifecycle, health checks, and deployment.
- Other direct children of `services/` are independent deployments.
- Keep shared Tools runtime code under `services/tools/runtime` only when more
  than one Tools product uses it.
- Keep scheduled work with the product that owns its state.
- Keep browser session routes and native bearer-token APIs separate. Do not
  weaken either authentication boundary to simplify a call site.
- PostgreSQL owns canonical runtime state. Private object storage owns artifact
  bodies and derived snapshots.

## Development

- Use Node.js 22.12 or newer and pnpm through Corepack.
- Check for a running development server or local stack before you start
  another one.
- Run the focused service test and typecheck first.
- Run `pnpm run verify` when a change crosses service, authentication, storage,
  or runtime boundaries.
- Keep deployment and monitoring definitions in typed code.

## Safety

- Never point a local or preview process at production data.
- Do not change Railway, Cloudflare, PostgreSQL, object storage, production
  authentication, or secrets without explicit direction.
- Do not run `pnpm run docker:reset` unless the user explicitly authorizes
  deletion of the local stack data.
- Do not commit secrets, session state, access tokens, or generated runtime
  data.
- Preserve public capability URLs, private browser routes, and machine API
  boundaries when you change routing or authentication.
- Report changed files, verification, production limits, and the next action in
  the final handoff.

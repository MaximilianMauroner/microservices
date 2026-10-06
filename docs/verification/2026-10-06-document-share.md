# Document Share delivery verification, 2026-10-06

Status: browser execution blocked. Local backend and proxy preparation passed.
No deployment, authenticated browser acceptance, or merge is established.

## Revision and scope

PR #51 combines Markdown and LaTeX source sharing. The code was rebased from
`114f4ca` onto main `4aa0154`, which adds verification documentation only.
The resulting code head is `2787add`. `git range-diff` reports both product
commits unchanged. The earlier regression, dead-code, redundant-test review,
684 passing tests, 23 PostgreSQL skips under the disposable-database guard,
Convex lint/typecheck, and Tools typecheck/build remain valid for the product
code. This run maintains the affected verification procedure; it does not
repeat unchanged product discovery. PR #52 is outside this task.

Node `24.21.0`; pnpm `11.16.0`. Worktree:
`/home/codex/.t3/worktrees/microservices/t3code-71c4b2c3`.
Private temporary preparation and evidence are under ignored
`.agents/artifacts/pr51-20261006/`. No capability, session, or credential is
published here.

## Owned local preparation

No healthy Document Share process was running. Resource checks showed enough
memory and disk. The shared `/tmp/microservices-intensive.lock` serialized
Convex preparation and the single verification worker.

1. Copy `services/markdown-share/{convex,package.json,source-limits.ts,tsconfig.json}`
   into the run's owned `backend/` directory. Link its `node_modules` to the
   installed service dependencies. Do not copy `.env.local` or `.convex`.
   Write owned `convex.json` with `{"aiFiles":{"enabled":false}}`.
2. In that directory start:

   ```sh
   flock /tmp/microservices-intensive.lock env CONVEX_AGENT_MODE=anonymous \
     pnpm exec convex dev --local-cloud-port 43151 --local-site-port 43152 \
     --typecheck disable --codegen disable --tail-logs disable
   ```

   Set `MARKDOWN_SHARE_ADMIN_TOKEN` only on this local deployment with
   `pnpm exec convex env set`, then require `Convex functions ready`.
   The CLI confirms a local, no-account deployment. All generated backend
   configuration and state belong to the run directory.
3. Start the real Tools Vite application on `127.0.0.1:43153` with
   `PLATFORM_READ_ONLY=true`, `PUBLIC_ORIGIN=http://localhost:43150`, and
   `VITE_CONVEX_URL=http://localhost:43150`. Use the local Convex HTTP action
   endpoint `http://127.0.0.1:43152/admin/documents` and its local token.
   Other required configuration uses local placeholders from `compose.yaml`;
   PostgreSQL and S3 target unused loopback ports 55432 and 59000. This is a
   public Document Share setup, not a healthy full Tools stack or OAuth login.
4. Start an owned loopback proxy on `127.0.0.1:43150`. Forward only
   `/api/query`, `/api/query_ts`, `/api/query_at_ts`, `/api/mutation`,
   `/api/action`, and WebSocket `/api/<version>/sync` to local Convex 43151.
   Forward other paths to Tools 43153, preserving headers and authentication.
   This keeps the browser Convex origin equal to the application origin without
   changing client validation, CSP, TLS checks, or production routes.

The ignored preparation files `start-tools.py`, `proxy.mjs`, and
`backend/smoke.mjs` record the executed fixture commands. They are temporary
run artifacts, not product changes.

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| Local `/share` and `/live` through the proxy | Passed | HTTP 200; liveness body `{"ok":true}`. |
| Tools global `/health` | Blocked | HTTP 503; isolated PostgreSQL/S3 were not provisioned. This is not a product regression. |
| Backend/proxy creation | Passed | Real public mutations created distinct `.md` Markdown and `.tex` LaTeX documents; reads preserved formats. |
| Backend edit and persistence | Passed | Real editor steps returned `synced`; accepted snapshots were reread exactly for both formats. |
| Backend checkpoint comparison | Passed | Two checkpoints compared with the exact edited source. No restore feature was claimed. |
| Same-origin WebSocket protocol | Passed | Real Convex subscriptions queried each created document through the proxy. |
| Administration inventory | Passed | Authorized local HTTP action returned both formats. This does not prove the protected Tools browser page. |
| Anonymous private inventory | Passed HTTP boundary | HTML `/documents` returned 302 to `/sign-in?returnTo=%2Fdocuments&reason=session_required`; JSON request returned 401. |
| Administration without bearer token | Passed | HTTP 401. |
| T3 environment-port route | Blocked | `preview_navigate` with port 43150 and path `/share` returned a navigation failure; the tab stayed blank. |
| T3 direct loopback route | Blocked | `http://localhost:43150/share` returned `net::ERR_CONNECTION_REFUSED` in the preview network snapshot. The preview user agent identifies the Mac host; the healthy listener is on the Linux environment. |
| Browser creation/editing, saved-state recovery, alias, history, `.tex` download | Blocked | No browser-reachable route to the isolated real backend. Local protocol checks do not establish these journeys. |
| Authenticated private inventory filters and navigation | Blocked | No authorized local Google OAuth client/subject session was supplied, independently of browser forwarding. |
| User acceptance and deployment | Unrun | Neither is established by local verification. |

An earlier run attempted a self-signed local HTTPS proxy and the preview
rejected it with `ERR_CERT_AUTHORITY_INVALID`. This run did not repeat that
route or disable TLS. Shared Tailscale settings, production data, credentials,
and paid infrastructure were not changed.

## Cleanup and next dependency

Stop only the owned proxy, Tools, and Convex process handles. Confirm ports
43150 through 43153 close. Dispose only the backend state created in the run's
owned directory; retain redacted preparation evidence. No shared database,
bucket, or volume is deleted. Cleanup passed: owned listeners 43150–43153 closed, and only this run's backend `.convex` state and `.env.local` were removed. Preparation scripts, sanitized protocol results, and browser error evidence remain available.

Owner: T3 preview/environment support must provide supported forwarding from
the Mac preview to the environment's loopback origin, or an existing trusted
isolated origin reachable by both hosts. Max/local OAuth setup must supply an
authorized development login for private inventory. Once available, run M1,
M2's authenticated path, and M3 in the maintained verification procedure.
Merge readiness remains blocked on those live checks. Manual deployment,
shared infrastructure changes, and authentication/TLS bypasses are not part
of this task.

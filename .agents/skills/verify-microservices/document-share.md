# Combined Document Share verification

Status: draft procedure, browser execution blocked on 2026-10-06 as recorded
below. Source and unit-test evidence do not establish browser acceptance. This
procedure covers PR #51; it does not expand verification to other products.

## Setup

Read `services/tools/README.md`, `services/markdown-share/README.md`, and the
shared skill setup. Record the exact head/base, Node/pnpm versions, selected
journeys, process handles, ports, commands, and private evidence directory.
Check existing processes, resources, and the shared heavy-work lock first.

Use an owned disposable local Convex backend with the real checked-out
functions and installed component packages. Record its data directory and
stop/disposal commands before creation. The administration mock on port 8787
cannot provide collaboration. Do not select a cloud or production deployment.
Set `VITE_CONVEX_URL` before Tools starts. Confirm backend readiness and a real
public query, then confirm Tools `/live` and dependency `/health` separately.
Record any unavailable Tools dependencies instead of calling it healthy.

For a remote browser, first use T3 `preview_status`, `preview_open`, and supported
environment-port forwarding. Browser reachability is separate from host HTTP
readiness. A same-origin loopback HTTP proxy can route only Convex's public
query, mutation, action, and synchronization protocol to the owned backend.
Keep Tools authentication, private APIs, and server functions on Tools. Keep
the WebSocket path and browser `Origin` valid. Use an origin accepted by the
existing Convex client validation and CSP. Do not disable TLS verification,
weaken authentication, or change shared settings to make the harness work.

Private inventory also needs isolated Tools dependencies, its local Convex
administration token, and an authorized local Google OAuth client/subject.
Sample OAuth placeholders cannot establish a session. If unavailable, perform
anonymous denial checks and record authenticated inventory as blocked.

## M1: creation, editing, collaboration, history, export

Run each format serially with a unique synthetic name and keep the capability
URLs private. Use snapshot locators to interact with the real loaded page.

1. Open `/share` without a session. Choose **Markdown**, enter
   `pr51-<run>-markdown`, and create. Expect a canonical
   `/share/d/<filename>--<capability>` URL and a `.md` filename in the header and
   browser title. Repeat with **LaTeX** and `pr51-<run>-latex`; expect `.tex`.
   The name field adds the selected extension and normalizes unsafe characters.
2. Focus the real contenteditable source editor. Replace its content with a
   short multiline fixture. For Markdown include a heading, list, and Unicode.
   For LaTeX include `\documentclass{article}`, `\begin{document}`, a literal
   escaped command, Unicode, and `\end{document}`. Record exact source, line
   breaks, and trailing newline. Wait for **Saved**, with no save alert. A text
   change alone does not prove acknowledgement.
3. Reload the capability URL and compare the editor's exact source with the
   fixture. Open it in a second independent browser session. Verify the same
   source and both viewers' presence. Edit in each session, wait for **Saved**,
   and verify the other session receives the edit without reload. Reload both
   and verify persistence. If the browser cannot supply two independent
   sessions, mark this part blocked; a backend client is not a second browser.
4. In **History**, choose **Save as checkpoint** after acknowledgement. Add a
   distinct source line, acknowledge it, and save a second checkpoint. Choose
   **Compare checkpoints** and verify Older/Newer selections, added/removed
   lines, author, time, and character count match the saved versions. Reload
   and reopen History to verify both checkpoints persist. There is no restore
   control; do not claim checkpoint restoration.
5. Replace `/share/d/` with `/markdown/d/` in each capability URL. The alias must
   open the same source and format without a session. Open `/markdown` and
   verify it still reaches public creation. Check an invalid capability shows
   unavailable access rather than a private document.
6. For Markdown, verify the live preview renders the fixture and **Export PDF**
   uses browser printing. Record whether the browser can open the print flow;
   a visible button alone does not prove export. For LaTeX, verify the source
   status panel states that PDF compilation is unavailable. Choose **Download
   .tex**. Inspect the actual download filename and UTF-8 bytes; they must equal
   the document filename and current acknowledged source, including escaped
   commands and line breaks. LaTeX has no compiler, engine choice, or PDF output.
7. Capture desktop and narrow viewport screenshots of the loaded source,
   preview/status, and controls. Compare with valid prior/base evidence for
   unrelated layout, copy, and animation. Record console and network failures.

## M3: source budget and recovery

Use only synthetic payloads in the real editor. Record character count and
`TextEncoder().encode(JSON.stringify(JSON.stringify(source))).byteLength` for
the resulting whole source. The limits are 500,000 characters and 900,000 bytes
after this encoding; backslashes, quotes, and Unicode can reach the byte limit
before the character limit.

1. Replace the source with a bounded multiline payload of about 10,000
   characters that includes quotes, backslashes, and Unicode. Paste through the
   editor's normal input path, wait for **Saved**, reload, and compare exact
   source. Repeat in both formats.
2. Attempt to replace it with 500,001 ASCII characters. Expect the visible
   character-limit alert. The editor and reloaded document must keep the last
   saved source. No oversized source may reach another session.
3. Attempt 300,000 backslashes, which fit the character limit but exceed the
   encoded-byte limit. Expect the visible **after encoding** alert and the
   previous source to remain intact on reload.
4. Paste a short valid replacement. Verify the alert clears, **Saved** appears,
   and reload/second session contain the replacement. If a retryable save error
   occurs, retain it until pending edits are acknowledged at a newer version;
   recording new local text alone is not recovery.

Do not infer offline multi-step batch behavior from these checks. A long offline
edit can accumulate protocol steps beyond the source budget. Verify such a batch
only with a supported owned connection-control harness and exact step evidence;
otherwise record it unrun. Do not change network, TLS, or shared proxy settings.

## M2: private inventory and retention

1. In an anonymous session, open `/documents`. Expect sign-in rather than the
   inventory. An anonymous `GET /api/ops/documents` must return
   `401 {"error":"authentication_required"}`. Record the actual response.
2. Sign in through the real local Google OAuth flow with the allowed test
   subject. Open `/documents`; expect the **Documents** title. Locate both
   created filenames with Markdown/LaTeX badges, checkpoint counts, latest-edit
   times, expiry, and public capability links. Reload and verify stable records.
3. Set **Document format** to Markdown, LaTeX, and All formats. Each filter must
   include only its expected owned records. Search each filename. Use **Sort
   documents**, **Expires within 24 h**, and **With checkpoints**; compare results
   with owned metadata. Reset the expiry filter if all newly created documents
   are excluded. Copy/open each link and verify the canonical `/share`
   path and exact source/format. Check the narrow inventory layout too.
4. Sign out. Verify private inventory access is removed while the unlisted
   capability pages still work anonymously. A backend administration response
   is useful state evidence, but does not prove this private browser journey.
5. Check retention only through a documented bounded local clock or scheduler.
   Unpinned documents expire seven days after the last edit; pinned documents
   expire after 30 days. Verify expired capability denial and cleanup in the
   disposable backend. Without bounded clock support mark retention blocked;
   do not wait days or alter production/system time.

## Evidence and cleanup

For each subjourney record passed, failed, blocked, or unrun, with revision,
source payload, browser origin, backend origin, command/protocol readiness,
actual public actions, acknowledgements, downloads, screenshots, and errors.
Record local checks, CI, independent review, merge, deployment, and user
acceptance separately. Keep tokens, OAuth credentials, sessions, and captures
out of commits and public comments.

Stop only the owned Tools, proxy, and backend sessions. Confirm their listeners
close. Dispose of the backend's owned temporary state as recorded before
creation; keep redacted evidence. Do not delete shared database/bucket volumes.
Remove owned browser downloads and recent-document entries after evidence is
retained. Sign out any owned authenticated session and restore its preferences.

## Execution record

PR #51 was checked on 2026-10-06 at head `2787add`, base `4aa0154`. The rebase
retained the prior code changes without a relevant behavior change. Evidence
and full commands are in
[the run report](../../../docs/verification/2026-10-06-document-share.md).

The owned backend used an ignored copy under
`.agents/artifacts/pr51-20261006/backend/`: `convex/`, `package.json`,
`source-limits.ts`, and `tsconfig.json`, with installed `node_modules` linked
from the service. Its owned `convex.json` disabled AI files only. From that copy:

```sh
flock /tmp/microservices-intensive.lock env CONVEX_AGENT_MODE=anonymous \
  pnpm exec convex dev --local-cloud-port 43151 --local-site-port 43152 \
  --typecheck disable --codegen disable --tail-logs disable
```

The local administration token was set with `convex env set`, using an owned
dummy value shared with the test Tools process. It is not recorded here. Tools
ran Vite in read-only mode on `127.0.0.1:43153`, with `PUBLIC_ORIGIN` and
`VITE_CONVEX_URL` set to `http://localhost:43150`. Database and object-storage
targets were unused local endpoints `127.0.0.1:55432` and `127.0.0.1:59000`.
This was public-document preparation, not a complete healthy Tools stack.

An owned HTTP/WebSocket proxy on `127.0.0.1:43150` forwarded only Convex public
`/api/query`, `/api/mutation`, `/api/action`, and `/api/*/sync` protocol requests
to port 43151. It sent other requests, including authentication and protected
server functions, to Tools on port 43153. No TLS or authentication check was
disabled, and no production or shared service was changed.

- Local readiness: `/share` and `/live` returned HTTP 200. `/health` returned
  HTTP 503 because the database and object storage were not provisioned.
- Protocol preparation: real local create for both formats, submitted edits
  and persistent snapshots, two checkpoints and comparison, a WebSocket query,
  and protected backend administration format metadata passed. These are
  protocol checks, not browser-journey passes.
- Browser access: T3's environment-port route for port 43150 failed navigation
  and stayed on `about:blank`. Direct `http://localhost:43150/share` from the
  remote Mac preview browser returned `net::ERR_CONNECTION_REFUSED`. Browser
  M1 and M3 are blocked before live creation, editing, downloads, clipboard
  rejection/recovery, or two-session collaboration can be accepted.
- Anonymous access: host HTTP `/documents` redirected to
  `/sign-in?returnTo=%2Fdocuments&reason=session_required` with HTTP 302 for
  `Accept: text/html`, and returned HTTP 401 for a JSON request. Backend
  `/admin/documents` without its token returned HTTP 401. These checks passed
  the HTTP denial boundary; they do not prove the sign-in browser flow.
- Private inventory: M2's signed-in path remains blocked. No authorized local
  OAuth client/subject or fully provisioned Tools dependencies were supplied.
  Retention and offline batches above the save budget remain unrun.
- Cleanup passed: owned Vite and proxy processes stopped with TERM; the owned
  Convex process stopped with Ctrl-C. Listener checks confirmed ports
  43150-43153 closed and the shared heavy-work lock released. Only the run's
  `backend/.convex` data/config and `backend/.env.local` were removed. Scripts
  and sanitized `protocol-result.json` remain in the ignored evidence directory.

The access dependency is the T3 preview environment owner: provide working
forwarding to the owned loopback service, or a supported browser attached to
that environment. The authenticated dependency is Max/local-environment setup:
provide authorized local OAuth and disposable Tools dependencies. Then rerun
the blocked public browser and private inventory actions. Deployment and user
acceptance are unverified.

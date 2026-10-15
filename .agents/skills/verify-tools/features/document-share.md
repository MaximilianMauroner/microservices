# Combined Document Share verification

Drive the real user paths and verify the saved result.

## Sub-features

- M1. At /share create Markdown and LaTeX documents; verify .md/.tex filenames, acknowledged source edits, reload persistence, second-session synchronization, presence, two checkpoints and comparison. Verify /markdown capability aliases, Markdown preview/PDF control, and exact LaTeX source download. Use the detailed journeys above.
- M2. Anonymous /documents and its inventory API deny access. After local sign-in, verify Documents title, filenames, format badges/filters, expiry, checkpoints, and capability links for both formats. Check invalid capability denial and bounded retention separately. Use the detailed journeys above.
- M3. Paste bounded multiline source with escapes and Unicode in each real editor. Confirm acknowledgement and reload. Reject source above the character or encoded-byte budget without replacing saved content; a smaller paste then saves. Use the detailed journeys above.

## How to get to it (user POV)

Open `/share` on the owned Tools origin. Publisher also has the native Fleet
upload CLI and canonical `/artifacts/` and `/files/` links.

## Driving it with T3 preview and the native CLI

Preconditions:

- The Tools doctor passes for this run's state directory.
- Private pages require an authorized local OAuth client and subject.
- Use the actions, expected results, and additional prerequisites below.

This extension covers combined Markdown and LaTeX sharing. Source and unit-test
evidence do not establish browser acceptance.

### Setup

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

### M1: creation, editing, collaboration, history, export

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

### M3: source budget and recovery

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

### M2: private inventory and retention

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

### Prior evidence

The [dated 2026-10-06 report](../../../../docs/verification/2026-10-06-document-share.md)
records protocol checks and browser/setup blockers. Reuse it only when the
source, setup, and expected results still match.

### Journey map

| ID | Public actions and observable result | Source and existing checks | Prerequisites and reset |
| --- | --- | --- | --- |
| M1 | At /share create Markdown and LaTeX documents; verify .md/.tex filenames, acknowledged source edits, reload persistence, second-session synchronization, presence, two checkpoints and comparison. Verify /markdown capability aliases, Markdown preview/PDF control, and exact LaTeX source download. Use the detailed journeys above. | services/markdown-share/README.md; markdown-share/App.tsx; markdown-share/collaborative-workspace.tsx; markdown-share/document-history.tsx; backend and workspace tests | Owned local Convex, browser-reachable origin, two independent sessions and download access. Establish disposable backend cleanup before creation. History supports comparison, not restoration. |
| M2 | Anonymous /documents and its inventory API deny access. After local sign-in, verify Documents title, filenames, format badges/filters, expiry, checkpoints, and capability links for both formats. Check invalid capability denial and bounded retention separately. Use the detailed journeys above. | src/routes/documents.tsx; src/routes/api/ops/$.ts; dashboard/ui/documents-page.tsx; test/documents-page.test.tsx; services/markdown-share/convex | Local Convex administration token, isolated Tools dependencies, authorized local OAuth. Retention is blocked without a supported bounded clock; never wait seven days or alter production time. |
| M3 | Paste bounded multiline source with escapes and Unicode in each real editor. Confirm acknowledgement and reload. Reject source above the character or encoded-byte budget without replacing saved content; a smaller paste then saves. Use the detailed journeys above. | services/markdown-share/source-limits.ts; markdown-share/live-document-session.ts; markdown-share/collaborative-workspace.test.tsx; convex/markdownShare.test.ts | M1 setup and synthetic clipboard payloads. Record payload sizes and each result. Offline multi-step batches beyond the budget need separate evidence. |

## Gotchas

Unavailable prerequisites mean blocked. A different entry point does not prove
an unrun path. Keep captures after cleanup. Use no production endpoint.

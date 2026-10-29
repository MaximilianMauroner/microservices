# Combined Document Share verification

This extension covers combined Markdown and LaTeX sharing. Source and unit-test
evidence do not establish browser acceptance.

## Setup

Read `services/tools/README.md` and the
shared skill setup. Record the exact head/base, Node/pnpm versions, selected
journeys, process handles, ports, commands, and private evidence directory.
Check existing processes, resources, and the shared heavy-work lock first.

Use the owned Tools stack and its PostgreSQL fixture. Document Share now runs
inside Tools. No separate backend, WebSocket proxy, or Convex token is needed.
Confirm `/live`, `/health`, and a real public creation and retrieval through
`/api/share/documents`. Confirm browser reachability separately from HTTP readiness.

Private inventory needs an authorized local Google OAuth client and subject.
Sample OAuth values cannot establish a session. Public sharing needs no OAuth.
If OAuth is unavailable, run anonymous denial checks and record authenticated
inventory as blocked. Keep private APIs and server functions protected.

Open two independent browser contexts. Edit both without a reload and verify
convergence. Take one context offline, edit both, restore its connection, and
verify both sources converge with no lost local text. Restart the owned Tools
process with the same database and verify acknowledged source, pin state, and
checkpoints persist. Do not change shared network or proxy settings.

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
5. Use only the owned fixture for retention. Set `expires_at` on one synthetic
   document to a past timestamp through its verified loopback database. Confirm
   expired capability denial and preservation of unsent source in an open
   offline browser after reconnect. Verify cleanup and cascades through the
   product expiry function or the required PostgreSQL suite. This row fixture
   proves the expiry gate. It does not prove elapsed-time scheduling. Do not
   alter system time or touch production records.

## Evidence and cleanup

For each subjourney record passed, failed, blocked, or unrun, with revision,
source payload, browser origin, backend origin, command/protocol readiness,
actual public actions, acknowledgements, downloads, screenshots, and errors.
Record local checks, CI, independent review, merge, deployment, and user
acceptance separately. Keep tokens, OAuth credentials, sessions, and captures
out of commits and public comments.

Stop only the owned Tools and dependency sessions. Confirm their listeners
close. Dispose of the backend's owned temporary state as recorded before
creation; keep redacted evidence. Do not delete shared database/bucket volumes.
Remove owned browser downloads and recent-document entries after evidence is
retained. Sign out any owned authenticated session and restore its preferences.

## Journey map

| ID | Public actions and observable result | Source and existing checks | Prerequisites and reset |
| --- | --- | --- | --- |
| M1 | At /share create Markdown and LaTeX documents; verify .md/.tex filenames, acknowledged source edits, reload persistence, second-session synchronization, presence, two checkpoints and comparison. Verify /markdown capability aliases, Markdown preview/PDF control, and exact LaTeX source download. Use the detailed journeys above. | services/tools/README.md; markdown-share/App.tsx; markdown-share/collaborative-workspace.tsx; markdown-share/document-history.tsx; backend and workspace tests | Owned local PostgreSQL, browser-reachable origin, two independent sessions and download access. Record owned PostgreSQL fixture cleanup before creation. History supports comparison, not restoration. |
| M2 | Anonymous /documents and its inventory API deny access. After local sign-in, verify Documents title, filenames, format badges/filters, expiry, checkpoints, and capability links for both formats. Check invalid capability denial and bounded retention separately. Use the detailed journeys above. | src/routes/documents.tsx; src/routes/api/ops/$.ts; dashboard/ui/documents-page.tsx; test/documents-page.test.tsx; markdown-share/repository.ts | Isolated Tools dependencies and authorized local OAuth. Use one owned expiry row fixture and verify cleanup separately. Never alter system time. |
| M3 | Paste bounded multiline source with escapes and Unicode in each real editor. Confirm acknowledgement and reload. Reject source above the character or encoded-byte budget without replacing saved content; a smaller paste then saves. Use the detailed journeys above. | markdown-share/source-limits.ts; markdown-share/live-document-session.ts; markdown-share/collaborative-workspace.test.tsx; markdown-share/repository.test.ts | M1 setup and synthetic clipboard payloads. Record payload sizes and each result. Offline multi-step batches beyond the budget need separate evidence. |

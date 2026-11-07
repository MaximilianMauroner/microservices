# Status

| ID | Public actions and observable result | Source and existing checks | Prerequisites and reset |
| --- | --- | --- | --- |
| S1 | Open authenticated /status. Use Dashboard then Status; inspect internal and external links without following production URLs. Send a bad local bearer token and expect 401. Run `pnpm run verify` to exercise the owned heartbeat-publication journey and inspect its report. That journey checks PostgreSQL and snapshot state, but does not reload `/status` in a browser after publication. | services/tools/app/routes/status.tsx; services/tools/platform/ui/components/tools-nav.ts; services/tools/products/status/ui/tools-status.tsx; services/tools/app/routes/api/status/heartbeats/$monitorId.ts; services/tools/test/products/status/status-links.test.tsx; services/tools/test/products/status/heartbeats.test.ts; services/tools/test/products/status/heartbeat-journey.ts | Core isolated setup and local sign-in. Default external links point to production; do not follow them. A browser reload after heartbeat publication remains unverified. |

Use sidebar **Dashboard** to open owned `/`, then **Status** to return. On mobile,
select **Open navigation** first. Expand service details and inspect each link's
actual `href` and destination ownership in the loaded private snapshot before
following it. Confirm an owned internal link stays on the owned Tools origin and
an owned external link opens its destination in a new tab. **External-link
substep: BLOCKED** unless a supported owned external destination is present in
the actual private snapshot. Default Tailscale, Tower, and Home Assistant links
still point to production. Do not follow production links or probe production
endpoints.

**Heartbeat publication.** The owned `heartbeat-publication` journey covers a
valid Tower heartbeat, invalid-token denial, canonical monitor overrides, one
nonduplicate checker run, and new private and public snapshot ETags. It also
requires the owned stack to report `cleanup: "disposed"`. It does not reload
`/status` in a browser after publication.

The heartbeat route checks the monitor ID before checking the bearer token.
An unknown monitor ID returns 404 even when the token is missing. The route has
no IP allowlist. Do not claim one.

The browser can drive only links to owned destinations. Default Tailscale,
Tower, and Home Assistant links point to production. Do not follow or probe
those URLs.

Use the supported cleanup route for owned heartbeat/checker facts. Do not
substitute bucket deletion, direct SQL, fabricated snapshots, or a global reset.
Stop only run-owned sessions and the exact Compose project; retain and record
owned volumes for later explicitly authorized disposal as the core requires.

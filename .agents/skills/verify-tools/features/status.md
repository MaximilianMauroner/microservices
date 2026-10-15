# Status

Drive the real user paths and verify the saved result.

## Sub-features

- S1. Open authenticated /status. Use Dashboard then Status; follow owned internal and external service links. Send a local bearer heartbeat for tower, then observe its updated private status after checker publication. Check a bad token returns 401.

## How to get to it (user POV)

Open `/status` on the owned Tools origin. Publisher also has the native Fleet
upload CLI and canonical `/artifacts/` and `/files/` links.

## Driving it with T3 preview and the native CLI

Preconditions:

- The Tools doctor passes for this run's state directory.
- Private pages require an authorized local OAuth client and subject.
- Use the actions, expected results, and additional prerequisites below.

| ID | Public actions and observable result | Source and existing checks | Prerequisites and reset |
| --- | --- | --- | --- |
| S1 | Open authenticated /status. Use Dashboard then Status; follow owned internal and external service links. Send a local bearer heartbeat for tower, then observe its updated private status after checker publication. Check a bad token returns 401. | src/routes/status.tsx; src/components/tools-nav.ts; status/ui/tools-status.tsx; src/routes/api/status/heartbeats/$monitorId.ts; test/status-links.test.tsx; test/public-pages.test.tsx; test/heartbeats.test.ts | Core isolated setup and local sign-in. Heartbeat/update and external-link prerequisites below are blocked. |

Use sidebar **Dashboard** to open owned `/`, then **Status** to return. On mobile,
select **Open navigation** first. Expand service details and inspect each link's
actual `href` and destination ownership in the loaded private snapshot before
following it. Confirm an owned internal link stays on the owned Tools origin and
an owned external link opens its destination in a new tab. **External-link
substep: BLOCKED** unless a supported owned external destination is present in
the actual private snapshot. Default Tailscale, Tower, and Home Assistant links
still point to production. Do not follow production links or probe production
endpoints.

**Heartbeat/update subjourney: BLOCKED.** The Status product/verification owner
must supply a supported route for safe canonical PostgreSQL target/pause
configuration, private snapshot publication, and cleanup of canonical
heartbeat/checker state before this subjourney runs. The native fixture setup starts seed and web
processes without a checker. Heartbeats write PostgreSQL; `/status` reads a
derived private snapshot. The normal checker uses typed targets and PostgreSQL
pause overrides, ignores seed catalog/pause flags, and enables production Home
Assistant unless canonically paused. UI bucket pauses do not write those
overrides. No supported override writer or state cleanup route is available.

After those routes exist, retain the [core](../SKILL.md) isolation and browser
session/bearer-token rules. Map checker configuration to the same owned
PostgreSQL and snapshot bucket, with only checker-reachable owned targets and
`DISCORD_WEBHOOK_URL` unset. Keep authentication and IP validation. Send the real
`tower` heartbeat, then require a bounded, nonduplicate checker run within its
freshness window that records a new successful Tower observation and publishes
the private snapshot. Duplicate runs in a five-minute slot do not observe new
heartbeats; do not change the environment to bypass run identity. Reload
authenticated `/status` and confirm Tower is operational with the new
observation time. HTTP 204 or changed `generatedAt` alone is insufficient.

Use the supported cleanup route for owned heartbeat/checker facts. Do not
substitute bucket deletion, direct SQL, fabricated snapshots, or a global reset.
Stop only run-owned sessions and the exact The native fixture setup project; retain and record
owned volumes for later explicitly authorized disposal as the core requires.

## Gotchas

Unavailable prerequisites mean blocked. A different entry point does not prove
an unrun path. Keep captures after cleanup. Use no production endpoint.

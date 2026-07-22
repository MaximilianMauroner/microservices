# Uptime Monitor

A single-owner Cloudflare Worker that serves a private React dashboard, checks up to 40 HTTP(S) sites, stores 30 days of checks in D1, and sends confirmed-down and recovery messages to Discord.

## Behavior

- Cloudflare Access protects the whole hostname. API routes additionally verify Access JWTs against the exact team issuer and application audience. `ENVIRONMENT=local` is the only authentication bypass.
- A cron runs every minute. UTC minute modulo five selects one persistent `schedule_slot`; each slot holds at most eight monitors, so every enabled monitor runs once per five minutes. Paused monitors retain their slot and count toward the 40-monitor cap.
- A successful final HTTP 200–399 marks a monitor up. The first failure shows checking; two consecutive failures mark it down and open an incident; one success resolves it.
- Each target and its one allowed redirect gets A + AAAA DNS validation before fetch. Private, loopback, link-local, reserved, documentation, unspecified, multicast, and mapped-private IPs are blocked. Responses time out after 10 seconds and bodies are never stored.
- Discord delivery is durable. Incident transitions are persisted first, and cron attempts at most one eligible notification. A successful send gets a timestamp; failures get normalized state and exponential or `Retry-After` backoff. `allowed_mentions.parse` is empty.

The worst-case scheduled invocation uses 48 monitoring subrequests: eight monitors × A, AAAA, and fetch for both the original target and one redirect. One Discord attempt brings the maximum to 49 of the Workers Free limit of 50. Every monitor gets one attempt each five-minute cycle, not all 40 in one invocation.

## Local setup

Prerequisites: Bun, a Cloudflare account, and Wrangler authentication.

```bash
cd services/uptime-monitor
cp .dev.vars.example .dev.vars
bun install
bunx wrangler d1 migrations apply uptime-monitor --local
bunx wrangler d1 execute uptime-monitor --local --file dev/seed.sql
bun run dev -- --host 0.0.0.0
```

The Vite development server should be exposed only on a trusted network. For remote development, use the host's Tailscale IP instead of a public bind. Keep `.dev.vars` uncommitted.

## Cloudflare provisioning

The checked-in `wrangler.jsonc` deliberately contains placeholders, never production identifiers.

1. Create separate preview and production D1 databases. Put their IDs into the corresponding fields in `wrangler.jsonc`, then apply migrations with `wrangler d1 migrations apply uptime-monitor --remote` for each environment.
2. Create a Cloudflare Access self-hosted application covering the entire Worker hostname. Add an Allow policy containing only the owner's exact email. Copy its AUD tag to `ACCESS_AUD`; set `ACCESS_TEAM_DOMAIN` to the exact `https://<team>.cloudflareaccess.com` issuer. Do not use an email domain-wide policy.
3. Set `ENVIRONMENT=production` and `DASHBOARD_URL` to the final HTTPS dashboard URL. Preview must also use a value other than `local` so authentication cannot be bypassed.
4. Create a Discord incoming webhook for the desired channel and store it with `wrangler secret put DISCORD_WEBHOOK_URL`. Use a separate webhook for preview. The URL is never stored in D1, returned by the API, or intentionally logged.
5. Deploy with `bun run deploy`. Verify the `* * * * *` trigger, assets route, D1 binding, Access policy, and custom domain in Cloudflare.

Rotate Discord by creating a replacement webhook, updating the Worker secret, sending a labeled test in the dashboard, and deleting the old webhook. Remove it with `wrangler secret delete DISCORD_WEBHOOK_URL` to disable alerts.

## Validation checklist

- Sign out: the browser enters Access. Sign in with a different identity: Access rejects it. Remove or corrupt the JWT on an API request: API returns 401.
- Add a site and confirm its initial check; pause/resume it; edit its URL; manually recheck; delete it with explicit confirmation.
- Fill all 40 slots and confirm an additional create gets `monitor_limit_reached`; verify eight monitors persist in each slot across a redeploy.
- Confirm real D1 checks survive redeploy and old raw checks disappear after 30 days.
- Exercise two failures and one recovery: normal operation sends one red down and one green recovery embed. During a Discord outage, confirm the incident stays pending and later drains.
- Check the dashboard at 375px and desktop widths, tab through every control, and verify visible focus and status text independent of color.

An ambiguous network failure after Discord accepted a webhook but before the Worker received its response can produce a duplicate on retry. Discord incoming webhooks do not provide an idempotency key; this is the only documented duplicate edge.

## Operations and rollback

Cloudflare logs should include request status, route, monitor numeric ID, normalized check error, and notification outcome only. Never log request headers, JWTs, webhook URLs, full exception objects, or response bodies. Alert operationally on repeated scheduler exceptions or a growing pending-notification count.

To stop checks immediately, disable the cron trigger in Cloudflare (or remove `triggers.crons` and deploy). To roll back code, deploy the prior Git commit. Use D1 Time Travel before reverting a destructive schema change; migrations are forward-only and should normally be corrected with a new migration. Deleting a monitor cascades its checks and incidents and should be treated as irreversible outside D1 recovery. Keep Access enabled during rollback.

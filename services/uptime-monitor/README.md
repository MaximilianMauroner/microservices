# Uptime Monitor

A single-owner Cloudflare Worker that serves a private React dashboard, checks up to 40 HTTP(S) sites, stores 30 days of checks in D1, and sends confirmed-down and recovery messages to Discord.

## Behavior

- Cloudflare Access protects the whole hostname. API routes additionally verify Access JWTs against the exact team issuer and application audience. `ENVIRONMENT=local` is the only authentication bypass.
- A cron runs every minute. UTC minute modulo five selects one persistent `schedule_slot`; each slot holds at most eight monitors, so every enabled monitor runs once per five minutes. Paused monitors retain their slot and count toward the 40-monitor cap.
- A successful final HTTP 200–399 marks a monitor up. The first failure shows checking; two consecutive failures mark it down and open an incident; one success resolves it.
- Each check is an HTTP(S) fetch, not ICMP ping. The original URL and its one allowed redirect reject direct literal private, loopback, link-local, reserved, documentation, unspecified, multicast, and mapped-private IPv4/IPv6 targets. Public bracketed IPv6 literals work. One 10-second deadline covers the complete redirect chain; response bodies are cancelled and never stored.
- Discord delivery is durable. Incident transitions are persisted first, and cron atomically leases at most one eligible notification before POSTing it. A successful send gets a timestamp; failures get normalized state and exponential or numeric/HTTP-date `Retry-After` backoff. Down alerts include the normalized opening failure, recoveries include latency, and `allowed_mentions.parse` is empty.

The worst-case scheduled invocation uses 16 monitoring subrequests: eight monitors × two HTTP requests when every target redirects once. One Discord attempt brings the maximum to 17 of the Workers Free limit of 50. Every monitor gets one attempt each five-minute cycle, not all 40 in one invocation.

This is intentionally a trusted, single-owner URL monitor. DNS hostnames are handed directly to Cloudflare `fetch`; the Worker does not resolve and pin an address. A hostname controlled by an attacker could use DNS rebinding to reach an address the literal checks would reject. Add only URLs you trust. Use a separate resolver-and-pinned checker if untrusted users will ever be allowed to submit targets.

## Local setup

Prerequisites: Bun, a Cloudflare account, and Wrangler authentication.

```bash
cd services/uptime-monitor
cp .dev.vars.example .dev.vars
bun install
bunx wrangler d1 migrations apply DB --local
bunx wrangler d1 execute DB --local --file dev/seed.sql
bun run dev -- --host 0.0.0.0
```

The Vite development server should be exposed only on a trusted network. For remote development, use the host's Tailscale IP instead of a public bind. Keep `.dev.vars` uncommitted.

## Cloudflare provisioning

The checked-in `wrangler.jsonc` contains the live production identifiers for repeatable deploys and clearly marked placeholders for the unprovisioned preview environment. Resource IDs and Access audience tags are identifiers, not credentials; secrets remain in Cloudflare.

1. Production uses the checked-in `uptime-monitor` D1 binding in Western Europe. Create a separate preview D1 database, replace only the clearly marked preview placeholder in `wrangler.jsonc`, and apply migrations independently with `bunx wrangler d1 migrations apply DB --remote --env preview` and `bunx wrangler d1 migrations apply DB --remote --env production`.
2. Create a Cloudflare Access self-hosted application covering the entire Worker hostname. Add an Allow policy containing only the owner's exact email. Copy its AUD tag to `ACCESS_AUD`; set `ACCESS_TEAM_DOMAIN` to the exact `https://<team>.cloudflareaccess.com` issuer. Do not use an email domain-wide policy.
3. Set `ENVIRONMENT=production` and `DASHBOARD_URL` to the final HTTPS dashboard URL. Preview must also use a value other than `local` so authentication cannot be bypassed.
4. Create separate Discord incoming webhooks and store them with `bunx wrangler secret put DISCORD_WEBHOOK_URL --env preview` and `bunx wrangler secret put DISCORD_WEBHOOK_URL --env production`. The URL is never stored in D1, returned by the API, or intentionally logged.
5. Deploy preview only with `bun run deploy:preview`, validate it, then deploy production only with `bun run deploy:production`. Both commands set `CLOUDFLARE_ENV` while Vite builds the flattened Wrangler configuration, then deploy that generated configuration without a redundant `--env` flag. Verify the `* * * * *` trigger, assets route, D1 binding, Access policy, and custom domain in each environment.

There is deliberately no generic `deploy` script. The top-level Wrangler target is named `uptime-monitor-local-dev`, has no cron or public `workers.dev` address, and is the only configuration with the `local` authentication bypass. Preview and production are reachable only after their explicit environment command and custom-domain provisioning; never deploy the top-level target as a substitute.

Rotate Discord by creating a replacement webhook, updating the environment-specific Worker secret, sending a labeled test in the dashboard, and deleting the old webhook. Remove it with `bunx wrangler secret delete DISCORD_WEBHOOK_URL --env <preview|production>` to disable alerts.

## Validation checklist

- Sign out: the browser enters Access. Sign in with a different identity: Access rejects it. Remove or corrupt the JWT on an API request: API returns 401.
- Add a site and confirm its initial check; pause/resume it; edit its URL; manually recheck; delete it with explicit confirmation.
- Fill all 40 slots and confirm an additional create gets `monitor_limit_reached`; verify eight monitors persist in each slot across a redeploy.
- Confirm real D1 checks survive redeploy and old raw checks disappear after 30 days.
- Exercise two failures and one recovery: normal operation sends one red down and one green recovery embed. During a Discord outage, confirm the incident stays pending and later drains.
- Check the dashboard at 375px and desktop widths, tab through every control, and verify visible focus and status text independent of color.

Delivery is at-least-once because Discord incoming webhooks do not provide an idempotency key. The lease prevents overlapping cron invocations from posting the same pending item concurrently, but a retry after an uncertain network outcome can still duplicate a message.

## Operations and rollback

Cloudflare logs should include request status, route, monitor numeric ID, normalized check error, and notification outcome only. Never log request headers, JWTs, webhook URLs, full exception objects, or response bodies. Alert operationally on repeated scheduler exceptions or a growing pending-notification count.

To stop checks immediately, disable the environment's cron trigger in Cloudflare, or temporarily set that environment's `triggers.crons` to `[]` and run its explicit `bun run deploy:preview` or `bun run deploy:production` command. Re-enable it with `["* * * * *"]` and deploy the same environment. Roll back Worker code with `bunx wrangler rollback --env=preview` or `bunx wrangler rollback --env=production`; inspect the target deployment before confirming. Use D1 Time Travel before reverting a destructive schema change; migrations are forward-only and should normally be corrected with a new migration. Deleting a monitor cascades its checks and incidents and should be treated as irreversible outside D1 recovery. Keep Access enabled during rollback.

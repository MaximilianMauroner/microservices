# Markdown Share alpha

A capability-link Markdown editor with Convex-backed metadata, seven-day
retention, ProseMirror OT synchronization, anonymous presence, a live GFM
preview, and browser PDF export. Cloudflare Workers Static Assets hosts only the
compiled frontend; all application data and realtime behavior live in Convex.

## Local setup

```sh
bun install
cd apps/markdown-share
bunx convex dev
bun run dev
```

`convex dev` writes `VITE_CONVEX_URL` to `.env.local`. Documents are editable by
anyone holding their unguessable URL and are deleted seven days after the latest
accepted editor change.

## Verification and deployment

```sh
bun run typecheck
bun run test
bun run deploy:production
```

`deploy:production` uses Convex's `--cmd-url-env-var-name` flow to inject the
production `VITE_CONVEX_URL` into the frontend build, then deploys that exact
artifact with Wrangler. Its build runs through the repository's `heavy-check`
guard. PDF export uses the browser print dialog and a print-only preview.

The shipped Cloudflare `_headers` file keeps capability URLs out of referrers
and search indexes, denies framing, disables MIME sniffing, and restricts
frontend connections to this app and its production Convex deployment.

### Legacy capability retirement

The public frontend no longer sends client-generated UUID capabilities, and
`documents.create` now accepts only server-generated capabilities. Deploy this
source state before removing the remaining compatibility data. Server-generated
capabilities use a transient Convex seed ID and leave no claim row.

After that deployment is confirmed live, an operator may delete legacy claim
rows and remove `capabilityClaims`, its backfill mutations, and legacy cleanup
branches. Do not purge those claims before the create-argument removal is live,
because an old backend could still accept a previously used capability.

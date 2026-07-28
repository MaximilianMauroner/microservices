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

The deployed alpha frontend still sends client-generated UUID capabilities, so
`documents.create` temporarily accepts that optional argument and records a
content-free permanent `legacy` claim. Server-generated capabilities use a
transient Convex seed ID and leave no claim row. After the legacy frontend has
been replaced everywhere, remove the optional `token` create argument first;
only after that deployment is live may an operator delete legacy claim rows (or
drop `capabilityClaims`) because callers can no longer select a previously used
capability. Do not purge those claims while the compatibility path is active.

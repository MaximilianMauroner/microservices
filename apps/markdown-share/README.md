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
bunx convex deploy
bun run build
bunx wrangler deploy
```

The build must receive the production `VITE_CONVEX_URL` when deploying the
frontend. PDF export uses the browser print dialog and a print-only preview.

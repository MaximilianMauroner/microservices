# Markdown Share Convex backend

Convex owns Markdown Share document metadata, ProseMirror synchronization,
anonymous presence, checkpoints, seven-day retention, cleanup, and the protected
administration HTTP action. Tools serves the browser application from
`/markdown`.

## Local development

```sh
pnpm install
pnpm run convex:dev
```

`convex dev` writes the local deployment URL to `.env.local`. Supply that value
as `VITE_CONVEX_URL` when building or starting Tools. Documents remain editable
by anyone holding their unguessable capability URL.

## Verification and deployment

```sh
pnpm run typecheck
pnpm run test
pnpm run convex:deploy
```

Deploy Convex before Tools if the generated API contract changes. Cloudflare and
Wrangler are not part of Markdown Share deployment.

## Legacy capability retirement

The backend still contains the bounded legacy capability cleanup path. Do not
remove legacy claim data until the deployed backend no longer accepts the old
client-generated capability contract.

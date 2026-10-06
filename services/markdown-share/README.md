# Markdown Share Convex backend

Convex owns Markdown Share document metadata, ProseMirror synchronization,
anonymous presence, checkpoints, seven-day retention, cleanup, and the protected
administration HTTP action. Tools serves the browser application from
`/share`, with existing `/markdown` links retained.

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

## Combined document formats

New documents store `format` as `markdown` or `latex`. The same plain-text
collaboration protocol and checkpoints serve both formats. Creation validates
`.md` or `.tex` against the chosen format. LaTeX currently supports collaborative
source editing and source download; PDF compilation is not implemented.

Deploy the Convex contract before the Tools browser changes. During this staged
rollout, creation without `format` and stored rows without `format` mean Markdown.
Make the field required only after old clients are retired and retained rows are
backfilled. The `markdown` API argument and checkpoint field remain wire/storage
names for source to preserve active clients and stored checkpoints.

## Source save limits

The editor and backend share the 500,000-character limit and a 900,000-byte
budget for encoded source. The byte budget leaves room below Convex's 1 MiB
value limit for editor JSON and metadata. Quotes, backslashes, and Unicode can
reach that budget before the character limit. Oversized local edits are rejected
with a visible message and leave the previous source intact. Existing documents
remain readable; edits must fit the save budget. Retryable save errors clear
only after all pending edits are acknowledged at a newer collaboration version.

# Preview verification

Use isolated buckets and an isolated Field Guide database. Configure a separate
Google OAuth web client whose callback points to the preview origin, plus a
preview-only `BETTER_AUTH_SECRET`.

Verify public pages, component health, canonical capability reads, allowed and
denied Google identities, deep-linked private SSR, public-to-private SPA
navigation, expiry recovery, sign-out, and native-token machine APIs. Do not
reuse production credentials or point the preview at production data.

Use [consolidation-cutover.md](./consolidation-cutover.md) for production order
and rollback.

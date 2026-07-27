# Bucket export and recovery

## Ownership map

| Object | Writer |
| --- | --- |
| `catalog/current.json` | Tools Web |
| `audit/**` | Tools Web, create-only |
| `state/current.json` | Tools Checker |
| `snapshots/public.json`, `snapshots/private.json` | Tools Checker |
| `history/YYYY-MM-DD.json.gz` | Tools Checker |
| `recovery/**`, `exports/**` | Tools Checker or an explicit operator export |

Never give either runtime an unrestricted code path around these prefixes.
Bucket credentials are secrets and must not be placed in commands saved to
shell history, logs, artifacts, or tickets.

## Export

Before cutover, schema migration, or manual repair, copy the complete bucket to
an encrypted operator-controlled location or a timestamped `exports/<stamp>/`
prefix using the Railway bucket UI or an S3-compatible client. Record object
keys, ETags, byte lengths, and SHA-256 hashes. Include catalog, state, both
snapshots, history, recovery, and audit objects.

Downloads of gzip history must remain compressed for hash comparison. Validate
JSON objects with the decoders in `@tools-platform/domain`; do not “fix” a
production export in place.

## Recovery

1. Disable the checker cron and place the admin UI in read-only operational
   mode by removing its bucket write credentials.
2. Export the damaged state before changing it.
3. Select a recovery object whose schema version is supported and whose catalog
   revision matches the intended snapshot.
4. Restore one object at a time with `If-Match` against the damaged object's
   current ETag. Use `If-None-Match: *` only when the destination is absent.
5. Re-read and decode the object, then compare its ETag/hash.
6. For catalog recovery, preserve existing audit objects and append an operator
   incident note outside the bucket; audit objects are immutable.
7. Run one manual checker pass with Discord unset. Verify public/private
   projections before restoring notifications and cron.

If `catalog/current.json` is missing, initialize it from the reviewed seed with
a create-only conditional write. Never use the seed to overwrite an existing
catalog. If state is missing, the checker creates empty state on its next pass;
that loses active incident/outbox continuity, so restore state when a valid copy
exists.

# Cloudflare Access incident

Use this runbook when `/manage` is unexpectedly public, valid operators cannot
authenticate, an Access audience changes, or a JWT/bucket credential may be
compromised.

## Contain

1. Disable the platform deployment or route `/manage*`, legacy `/ops*`, and `/api/ops/*`
   to a deny-all Access policy. Keep the public directory available only if its
   routing is clearly separate.
2. Remove the web service's bucket write credentials. The checker can continue
   because it has separate ownership credentials.
3. Rotate the S3 access key if exposure is possible. Do not log the old or new
   value.
4. Export `catalog/current.json` and `audit/**`; compare revisions and actors
   with the last known-good deployment.
5. If a catalog revision has no corresponding audit object, keep web write
   credentials removed and follow the audit-repair gate in
   `bucket-recovery.md`. A failed HTTP response does not prove the catalog
   write failed.

## Diagnose

- Verify the Access applications cover `/publish*`, `/uploads*`,
  `/api/external-uploads`, `/review*`, `/manage*`, protected legacy page
  aliases, and their protected APIs. Ensure Access does not intercept public
  `GET`/`HEAD` capability delivery at `/artifacts/*`, `/files/*`, `/p/*`, or
  `/f/*`; the origin still protects non-read methods on those paths.
- Verify `CF_ACCESS_ISSUER` is the exact `*.cloudflareaccess.com` team origin and
  `CF_ACCESS_MANAGE_AUDIENCE`, `CF_ACCESS_PUBLISHER_AUDIENCE`, and
  `CF_ACCESS_REVIEW_AUDIENCE` match their intended route-family applications.
- Verify the app rejects missing, expired, wrong-issuer, wrong-audience, and
  incorrectly signed assertions. Edge headers alone are never sufficient.
- Review sanitized request events by request ID. Logs intentionally omit
  headers, tokens, bodies, webhook URLs, and full exception messages.

## Recover

Restore a least-privilege Access policy, rotate credentials, redeploy, and test
with an allowed and denied identity. Confirm catalog writes generate immutable
audit objects and a stale `If-Match` produces an explicit `409` without retry.
Only then restore the route and bucket write credential.

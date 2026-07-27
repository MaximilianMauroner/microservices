# Cloudflare Access incident

Use this runbook when `/ops` is unexpectedly public, valid operators cannot
authenticate, an Access audience changes, or a JWT/bucket credential may be
compromised.

## Contain

1. Disable the `tools-web` public deployment or route `/ops*` and `/api/ops/*`
   to a deny-all Access policy. Keep the public directory available only if its
   routing is clearly separate.
2. Remove the web service's bucket write credentials. The checker can continue
   because it has separate ownership credentials.
3. Rotate the S3 access key if exposure is possible. Do not log the old or new
   value.
4. Export `catalog/current.json` and `audit/**`; compare revisions and actors
   with the last known-good deployment.

## Diagnose

- Verify the Access application covers both `/ops*` and `/api/ops/*`.
- Verify `CF_ACCESS_ISSUER` is the exact `*.cloudflareaccess.com` team origin and
  `CF_ACCESS_AUDIENCE` is the application audience.
- Verify the app rejects missing, expired, wrong-issuer, wrong-audience, and
  incorrectly signed assertions. Edge headers alone are never sufficient.
- Review sanitized request events by request ID. Logs intentionally omit
  headers, tokens, bodies, webhook URLs, and full exception messages.

## Recover

Restore a least-privilege Access policy, rotate credentials, redeploy, and test
with an allowed and denied identity. Confirm catalog writes generate immutable
audit objects and a stale `If-Match` produces an explicit `409` without retry.
Only then restore the route and bucket write credential.

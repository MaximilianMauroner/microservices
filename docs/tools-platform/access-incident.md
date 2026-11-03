# Browser authentication incident

Use this runbook when a private route is unexpectedly public, the authorized
Google account cannot sign in, or session material may be compromised.

## Contain

1. Disable the platform deployment if private data may be exposed. Keep public
   routes online only when their routing is clearly separate.
2. Delete the affected rows in `tools.auth_sessions`. Tools reads the session
   row on each request, so the next request from that cookie fails. Delete all
   rows to end every browser session.
3. Rotate `BETTER_AUTH_SECRET` if it may have been exposed. The rotation also
   makes every session cookie invalid. Never log either secret value.
4. Rotate the Google OAuth client secret if it may have been exposed.
5. Remove database and object-storage write credentials while investigating
   unauthorized writes.

## Diagnose

- Confirm `/api/auth/callback/google` is registered on the correct Google OAuth
  web client and `PUBLIC_ORIGIN` exactly matches the deployed origin.
- Confirm `AUTH_ALLOWED_GOOGLE_SUBJECT` is the stable `sub` for the intended
  account. Do not substitute an email address.
- Test an anonymous private document, private JSON request, expired session,
  allowed Google account, and a different valid Google account.
- Review sanitized request events only. Logs must not contain tokens, cookies,
  authorization codes, secrets, or identity claims.

## Recover

Redeploy with the corrected variables. Verify public and native-token machine
routes first, then verify allowed and denied browser identities. Restore data
store credentials only after private writes and audit attribution are correct.

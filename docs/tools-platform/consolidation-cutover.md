# Better Auth browser-session cutover

This cutover changes browser authentication without moving the catalog bucket,
artifact bucket, Field Guide database, or machine credentials.

## Required external state

1. Create one Google OAuth web client and register
   `https://tools.mauroner.net/api/auth/callback/google`.
2. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BETTER_AUTH_SECRET`, and
   `AUTH_ALLOWED_GOOGLE_SUBJECT` on the platform service.
3. Remove edge authentication from the application hostname so `/api/auth/*`
   callbacks and the first-party session reach the application unchanged.
4. Keep `/api/uploads*`, `/api/agent*`, and `/api/heartbeat/tower` on their
   existing native bearer-token contracts.

## Verification before production

- Public `/`, `/status`, health routes, and canonical artifact/file reads work
  without a browser session.
- Anonymous private document requests redirect to `/sign-in`; anonymous private
  APIs return `401` without private data.
- The allowed Google subject can open deep links and navigate between public and
  private pages without document reloads.
- A different valid Google account reaches the explicit unauthorized state and
  receives no session.
- Sign-out and expiry stop private access. Return paths reject cross-origin and
  recursive values.
- Machine upload, agent, and heartbeat requests still use their existing tokens.

## Cutover

Deploy the verified build, set the variables, complete one allowed and one
denied Google sign-in, and only then remove the old edge policies. Do not change
live catalog data, buckets, databases, or machine secrets during this cutover.

## Rollback

Restore the previous application build and its matching external authentication
configuration. Keep data stores unchanged. If the new session secret may have
escaped, rotate it even after rollback.

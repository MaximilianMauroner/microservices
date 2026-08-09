# Platform Service

The platform service is the single production compute and browser-authentication boundary for Mauroner Tools.

## Route policy

| Surface | Authentication |
| --- | --- |
| `/`, `/status`, health routes, and fixed public assets | Public |
| `/artifacts/*` and `/files/*` `GET`/`HEAD` | Public unlisted capability URL |
| `/sign-in` and `/api/auth/*` | Public authentication flow |
| `/publish`, `/review`, `/manage/*`, `/tools/private/*`, and their browser APIs | Better Auth Google session |
| `/api/uploads*`, `/api/agent*`, and `/api/heartbeat/tower` | Existing native bearer token |

TanStack document requests and protected server functions resolve the same
application session. Private SPA navigation therefore stays inside the router;
the shared `/_serverFn` endpoint no longer depends on an edge route policy.
Anonymous private document requests redirect to `/sign-in`, while private JSON
requests return `401 {"error":"authentication_required"}`. Protected responses
are private and non-cacheable.

## Browser authentication

Better Auth runs without an auth database. It uses a secure, HTTP-only,
same-site encrypted cookie with a 12-hour lifetime. Google is the only provider
and requests only the default OpenID, email, and profile scopes. The verified
Google `sub` must exactly match `AUTH_ALLOWED_GOOGLE_SUBJECT` before a session
is created.

Required variables:

- `PUBLIC_ORIGIN`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `BETTER_AUTH_SECRET`, at least 32 non-whitespace characters
- `AUTH_ALLOWED_GOOGLE_SUBJECT`

The Google OAuth web client must register this exact callback URL:

```text
${PUBLIC_ORIGIN}/api/auth/callback/google
```

Google uses online access only. The application does not request offline
refresh-token capability or retain a provider-account cookie. Changing
`BETTER_AUTH_SECRET` invalidates existing sessions.

The service preserves its existing S3 buckets and Field Guide PostgreSQL
database. Browser authentication does not add or migrate database tables.

## Commands

```bash
pnpm run build
pnpm run typecheck
pnpm run test
pnpm run start
```

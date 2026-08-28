# Platform Service

The platform service is the single production compute and browser-authentication boundary for Mauroner Tools.

## Route policy

| Surface | Authentication |
| --- | --- |
| Health routes and fixed public assets | Public |
| `/artifacts/*` and `/files/*` `GET`/`HEAD` | Public unlisted capability URL |
| `/sign-in` and `/api/auth/*` | Public authentication flow |
| `/`, `/status`, `/money`, `/feedback`, `/publish`, `/review`, `/manage/*`, `/tools/private/*`, and their browser APIs | Better Auth Google session |
| `/feedback/f/:token` `GET`/`HEAD`/`POST` | Public unlisted capability URL |
| `/markdown` and `/markdown/d/:capability` `GET`/`HEAD` | Public creation and unlisted capability pages |
| `/api/uploads*`, `/api/agent*`, and `/api/heartbeat/tower` | Existing native bearer token |

TanStack document requests and protected server functions resolve the same
application session. Private SPA navigation therefore stays inside the router;
the shared `/_serverFn` endpoint no longer depends on an edge route policy.
Anonymous private document requests redirect to `/sign-in`, while private JSON
requests return `401 {"error":"authentication_required"}`. Protected responses
are private and non-cacheable.

## Browser authentication

Better Auth runs without an auth database. It uses a secure, HTTP-only,
same-site encrypted cookie with a seven-day lifetime. Google is the only provider
and requests only the default OpenID, email, and profile scopes. The verified
Google `sub` must exactly match `AUTH_ALLOWED_GOOGLE_SUBJECT` before a session
is created.

Required variables:

- `PUBLIC_ORIGIN`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `BETTER_AUTH_SECRET`, at least 32 non-whitespace characters
- `AUTH_ALLOWED_GOOGLE_SUBJECT`
- `VITE_CONVEX_URL`, the public Convex origin used by the Markdown Share browser client and CSP

The Google OAuth web client must register this exact callback URL:

```text
${PUBLIC_ORIGIN}/api/auth/callback/google
```

Google uses online access only. The application does not request offline
refresh-token capability or retain a provider-account cookie. Changing
`BETTER_AUTH_SECRET` invalidates existing sessions.

Tools uses one Railway PostgreSQL instance with separate `tools`,
`field_guide`, and `artifacts` schemas. Artifact bodies remain in private object
storage; metadata and interrupted-operation recovery live in PostgreSQL.
Dashboard and monitor definitions are versioned code rather than editable
database records.

## Commands

```bash
pnpm run build
pnpm run typecheck
pnpm run test
pnpm run start
```

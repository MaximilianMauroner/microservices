# Platform Service

The platform service is the single production compute and browser-authentication boundary for Mauroner Tools.

## Folders

| Folder | Holds |
| --- | --- |
| `app` | The web entry: route files, the router, and the server start |
| `platform` | What every product uses: `auth`, `access` (people, grants, MCP), `database`, `scheduler`, `ui`, the request `gateway`, and the shared `domain` and `security` code |
| `products` | One folder per product: `dashboard`, `documents` (Document Share), `feedback`, `kitchen`, `money`, `publisher`, and `status` |
| `test` | All tests. `test/app`, `test/platform`, and `test/products` mirror the source folders. `test/harness` runs the verification stacks, and `test/support` holds shared test helpers |

[runtime-boundaries.md](../../docs/tools-platform/runtime-boundaries.md) gives
the reason for this split.

This folder is one pnpm package. Code in one folder imports another folder through
the `#` subpath imports in `package.json`.

## Route policy

| Surface | Authentication |
| --- | --- |
| Health routes and fixed public assets | Public |
| `/artifacts/*` and `/files/*` `GET`/`HEAD` | Public unlisted capability URL |
| `/drop/:token` `GET`/`HEAD` and `/api/drop/:token/uploads` `POST` | Public, expiring upload capability URL |
| `/sign-in` and `/api/auth/*` | Public authentication flow |
| `/`, `/status`, `/money`, `/feedback`, `/publisher`, `/api/upload-links`, `/manage/*`, `/tools/private/*`, and their browser APIs | Better Auth Google session |
| `/feedback/f/:token` `GET`/`HEAD`/`POST` | Public unlisted capability URL |
| `/share`, `/share/d/:capability`, `/markdown` and `/markdown/d/:capability` `GET`/`HEAD` | Public creation and unlisted capability pages |
| `/api/uploads*` and `/api/heartbeat/tower` | Existing native bearer token |

TanStack document requests and protected server functions resolve the same
application session. Private SPA navigation therefore stays inside the router;
the shared `/_serverFn` endpoint no longer depends on an edge route policy.
Anonymous private document requests redirect to `/sign-in`, while private JSON
requests return `401 {"error":"authentication_required"}`. Protected responses
are private and non-cacheable.

## Browser authentication

Better Auth stores sessions in PostgreSQL. A session lasts seven days in a
secure, HTTP-only, same-site cookie. Google is the only provider and requests
only the default OpenID, email, and profile scopes.

The admin is the Google account whose verified `sub` matches
`AUTH_ALLOWED_GOOGLE_SUBJECT`. The admin can invite other people by Google email
in Settings and grant them products. Each person sees only their own data. See
[people-and-access.md](../../docs/tools-platform/people-and-access.md).

MCP clients connect to `/api/mcp` through OAuth sign-in and consent. That
endpoint accepts only its OAuth bearer token.

Required variables:

- `PUBLIC_ORIGIN`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `BETTER_AUTH_SECRET`, at least 32 non-whitespace characters
- `FEEDBACK_ENCRYPTION_KEY`, a base64url-encoded 32-byte key for response encryption
- `BODYSHOP_ENCRYPTION_KEY`, a base64url-encoded 32-byte key for Bodyshop records. A lost key makes the records unreadable.
- `AUTH_ALLOWED_GOOGLE_SUBJECT`

The Google OAuth web client must register this exact callback URL:

```text
${PUBLIC_ORIGIN}/api/auth/callback/google
```

Google uses online access only. The application does not request offline
refresh-token capability or retain a provider-account cookie. Changing
`BETTER_AUTH_SECRET` invalidates existing sessions.

Tools uses one Railway PostgreSQL instance with separate `tools` and
`artifacts` schemas. Artifact bodies remain in private object
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

## Document Share

`/share` creates Markdown or LaTeX documents in one collaborative editor.
Tools owns document state, collaboration, checkpoints, and retention in PostgreSQL.
The public document API uses the same origin as the browser.
`/documents` lists both formats behind the browser session boundary. It shows
only the signed-in person's documents. A document belongs to the person who was
signed in when it was created. Anonymous documents and documents from before
ownership belong to the admin. Capability links and the public document API do
not check the owner.
Markdown retains live preview and browser PDF printing. LaTeX currently shares
and downloads `.tex` source; compiler hosting and engine selection remain open.
Existing `/markdown` capability routes continue to resolve the same documents.
Browser recent-document and display-setting keys remain unchanged to preserve
saved links and preferences.

## Runtime verification

The root `pnpm run verify` command reports `automatedDecision` and
`manualAcceptance` separately. Exit code zero requires every implemented test,
receipt publication, and owned fixture disposal to pass. It does not accept the
manual browser gates.

The built Tools journeys include a real heartbeat POST and a bounded Status
checker pass against owned PostgreSQL and object storage. The checker uses only
Tower and a paused local control. It refuses external targets and notifications.
The mounted Status link regression remains a required automated case.

Three manual gates remain blocked and owned by Max. They cover the authenticated
upload link, authenticated cross-origin denial, and the historical middleware
comparison. Each gate requires real Google OAuth sessions and evidence bound to
the reviewed revision and owned fixture. These gates block merge until Max
accepts the evidence. The runner cannot import or grant manual acceptance.

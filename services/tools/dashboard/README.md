# Dashboard

Dashboard is the product directory and navigation surface mounted by the Tools
monolith. It is code inside `services/tools`, not a separately deployed service.

## Production runtime

The repository-root `railway.json` starts Tools. The process stays awake because
it also owns leased Status scheduling. Product names, descriptions, grouping,
links, visibility, and monitor references are defined in typed code under this
directory. Runtime status data comes from PostgreSQL-backed Status projections.

The private Markdown inventory also requires:

- `MARKDOWN_SHARE_ADMIN_ENDPOINT`, the production Convex HTTP Action URL
- `MARKDOWN_SHARE_ADMIN_TOKEN`, a 32+ character service secret shared with Convex
- `MARKDOWN_SHARE_PUBLIC_ORIGIN`, the Markdown Share browser origin

Tools authenticates browser requests before dispatching them to this module and
supplies a verified principal for attribution.
Native-token `/api/uploads*` and `/api/agent*` routes keep their own bearer
credentials.

`GET /live` reports process liveness. `GET /health` checks all shared
dependencies. The component endpoints `/health/tools`, `/health/publisher`,
and `/health/review` report only their named dependency and require no browser
session so the checker can report each component truthfully.

## Data ownership

Dashboard owns presentation definitions in code. Status owns monitor behavior
in code and runtime observations in PostgreSQL. The dashboard may render
prepared public and private projections, but it does not own or mutate monitor
state. `config/initial-catalog.json` remains the validated projection source
consumed by the Status store; it is deployed with the application rather than
edited at runtime.

## UI behavior

The Status product reports **Observed uptime** only over recorded checks;
the 90-cell calendar marks days without data separately and names the earliest
observed day. Its aggregate gives outages and checking states precedence, then
reports healthy measured services separately from services not measured.
Below the public services it links to `/manage/status`, which uses the Manage
Access audience and renders only active services excluded from the public
projection. The response requires the shared browser session, is non-cacheable, and does not render
operator notes, notification delivery details, or monitor target URLs.
Directory destinations on the current browser origin use a chevron and open
in the current tab. Cross-origin destinations use an external arrow, open in a
new tab with `rel=noreferrer`, and announce that behavior to assistive
technology.

Manage uses a project-filtered artifact library and one focused lifecycle
inspector. Browser actions replace persistent HTML in place, update its project
metadata, copy or open capability URLs, and revoke stored artifacts through the
same-origin `/api/external-uploads/:id` routes. The native upload token is never
sent to the browser.
`/manage/documents` is a read-only Markdown Share inventory. It uses the same
browser session and fetches active document metadata through a bearer-
protected Convex HTTP Action, and never retrieves document bodies.

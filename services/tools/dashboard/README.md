# Dashboard

Dashboard is the product directory and navigation surface mounted by the Tools
monolith. It is code inside `services/tools`, not a separately deployed service.

## Production runtime

The repository-root `railway.json` starts Tools. A separate bounded Railway cron
process runs Status checks every 30 minutes. The Tools web process can sleep
between requests and scheduled work. Product names, descriptions, grouping,
links, visibility, and monitor references are defined in typed code under this
directory. Dashboard reads derived Status snapshots from private object storage.
PostgreSQL owns the runtime Status state.

The private Markdown inventory also requires:

- `MARKDOWN_SHARE_ADMIN_ENDPOINT`, the production Convex HTTP Action URL
- `MARKDOWN_SHARE_ADMIN_TOKEN`, a 32+ character service secret shared with Convex
- `PUBLIC_ORIGIN`, also used for the integrated Markdown Share browser origin

The Markdown inventory loads 50 active documents per request. The browser can
continue through additional pages with a private cursor until all are loaded.

Tools authenticates browser requests before dispatching them to this module and
supplies a verified principal for private reads.
Native-token `/api/uploads*` routes keep their own bearer credentials.

`GET /live` reports process liveness. `GET /health` checks all shared
dependencies. The component endpoints `/health/tools` and `/health/publisher`
report only their named dependency and require no browser session so the checker
can report each component truthfully.

## Data ownership

Dashboard owns presentation definitions in code. Status owns monitor behavior
in code and runtime observations in PostgreSQL. Dashboard reads prepared public
and private projections. It does not mutate catalog or monitor state.
`config/initial-catalog.json` is the validated projection source consumed by the
Status store. It is deployed with the application. Dashboard does not read a
separate catalog from object storage. Readiness requires both derived snapshots.

## UI behavior

The Status product reports **Observed uptime** only over recorded checks;
the 90-cell calendar marks days without data separately and names the earliest
observed day. Its aggregate gives outages and checking states precedence, then
reports healthy measured services separately from services not measured.
The `/status` page requires the shared browser session and shows public and
private services. Its loader reads `/api/ops/snapshot`, which requires the same
session and returns a private, non-cacheable response. The page does not render
operator notes, notification delivery details, or monitor target URLs.
Directory destinations on the current browser origin use a chevron and open
in the current tab. Cross-origin destinations use an external arrow, open in a
new tab with `rel=noreferrer`, and announce that behavior to assistive
technology.

Manage at `/publisher/artifacts` uses a project-filtered artifact library and
one focused lifecycle inspector. Browser actions replace persistent HTML in place, update its project
metadata, copy or open capability URLs, and revoke stored artifacts through the
same-origin `/api/external-uploads/:id` routes. The native upload token is never
sent to the browser.
`/documents` is the read-only Markdown and LaTeX inventory. It uses the same
browser session and reads `/api/ops/documents`. Tools fetches active document
metadata through a bearer-protected Convex HTTP Action. It never retrieves
document bodies. The inventory API supports private pagination cursors.

The former `/manage/*` and `/ops/*` dashboard pages are not production routes.
The dashboard has no catalog mutation, audit, history, or incident administration
API. Manage retains its Publisher lifecycle APIs.

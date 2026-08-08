# Runtime boundaries

Repository location defines runtime ownership:

- `apps/platform-service` is the only integrated TanStack application. Its
  routes use client navigation and share the platform loading experience.
- Other `apps/*` directories are independently hosted applications. Links to
  them cross a document and runtime boundary.
- `packages/*` directories are reusable capabilities. They cannot own a
  deployment or browser entry point.
- `jobs/*` directories are independently running background processes without
  a browser surface.

Access is an independent property. Public, Cloudflare Access-protected, and
private-network tools can exist on either side of the runtime boundary. Catalog
`visibility` and link `access` describe that policy; directory location does
not.

When adding a tool:

1. Add a platform feature under `apps/platform-service/src/features` when it
   belongs to the shared TanStack runtime.
2. Add an `apps/<name>` workspace only when it has an independent deployment.
3. Extract reusable logic to `packages/<name>` without adding deployment
   configuration there.
4. Register visibility and access explicitly in the typed catalog.

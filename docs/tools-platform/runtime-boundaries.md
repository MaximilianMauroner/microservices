# Runtime boundaries

Repository location defines runtime ownership:

- `services/tools` is the integrated TanStack application. Its products share
  client navigation, authentication, health, lifecycle, and deployment.
- Other `services/*` directories are independently hosted services. Links to
  them cross a document and runtime boundary.
- Direct children of `services/tools/*` are products in the Tools monolith.
- Scheduled work belongs to the product that owns its state. Tools products run
  leased tasks in the Tools process; Markdown Share uses Convex scheduling.

Authentication is independent of deployment. Public, session-protected, and
private-network products may exist on either side of a runtime boundary.

When adding a product or service:

1. Add a direct product under `services/tools/<name>` when it belongs to the
   Tools process.
2. Add `services/<name>` only when it has an independent deployment.
3. Keep cross-product runtime behavior under `services/tools/runtime` only when
   it has multiple consumers inside the monolith.
4. Define dashboard identity and status monitoring behavior in typed code.

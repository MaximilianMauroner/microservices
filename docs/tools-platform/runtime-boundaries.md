# Runtime boundaries

Repository location defines runtime ownership:

- `services/tools` is the integrated TanStack application. Its products share
  client navigation, authentication, health, lifecycle, and deployment.
- Other `services/*` directories are independently hosted services.
- Document Share (formerly Markdown Share) belongs to Tools. Its capability
  links, document state, and retention have one owner so backup and recovery
  preserve the same documents.
- Scheduled work belongs to the product that owns its state. Tools products retain
  their scheduled state. Status probes run in a dedicated bounded cron process;
  other Tools leased tasks run in the web process. Document Share owns its
  retention work in Tools.

Authentication is independent of deployment. Public, session-protected, and
private-network products may exist on either side of a runtime boundary.

## Tools folders

Tools has three source folders, and each folder answers one question:

- `app/` is the web entry: the route files and the server and router setup.
  It answers "which URL runs which code".
- `platform/` is what every product depends on: sign-in, people and access,
  the database, scheduling, and the shared interface.
  It answers "what does each product get for free".
- `products/<name>/` is one product: its data, its server functions, and its
  screens. It answers "where does this product live".

Tests mirror these folders under `test/`, so a test is easy to find from the
code it checks.

The reason for this split: a reader who opens `services/tools` sees the
products at once, and a product folder holds all of that product. Before, the
products, the shared runtime, and the framework entry were siblings, and a
reader could not tell which was which.

## Adding a product or service

1. Add `services/tools/products/<name>` when the product belongs to the Tools
   process. Put its routes under `app/routes`.
2. Add `services/<name>` only when it has an independent deployment.
3. Move code to `platform/` only when more than one product uses it.
4. Define dashboard identity and status monitoring behavior in typed code.

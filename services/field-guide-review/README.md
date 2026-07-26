# Field guide review

Review-only service for immutable project and global field-guide candidates. Agents submit candidates and sync verdicts; the Shoo-authenticated owner can approve, reject, defer, confirm, or invalidate them without editing or deleting content.

Required variables: `DATABASE_URL`, `AGENT_API_TOKEN`, `SHOO_ALLOWED_EMAIL`, and `PUBLIC_BASE_URL`. `PORT` defaults to `3000`. Railway uses `railway.json`, runs the owned migration at startup, and checks `/health`.

Agent API: `POST /api/agent/candidates`, `GET /api/agent/decisions`, and `POST /api/agent/receipts`. Reviewer API: `GET /api/review/queue` and `POST /api/review/candidates/:id/rounds/:round/verdict`. There are intentionally no update or delete routes.

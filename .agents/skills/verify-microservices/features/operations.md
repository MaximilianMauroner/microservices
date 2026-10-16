# Operations

| ID | Public actions and observable result | Source and existing checks | Prerequisites and reset |
| --- | --- | --- | --- |
| O1 | GET /live, /health, and documented component-health routes with dependencies ready. Stop only an owned dependency and verify readiness fails while liveness remains meaningful. Restart, require readiness, then stop the owned web process and confirm shutdown. | src/routes/live.ts; src/routes/health/$component.ts; test/start.test.ts; test/publisher-runtime-shutdown.test.ts | Disposable stack only. Restore dependencies before subsequent journeys. |

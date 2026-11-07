# Operations

| ID | Public actions and observable result | Source and existing checks | Prerequisites and reset |
| --- | --- | --- | --- |
| O1 | GET /live, /health, /health/tools, and /health/publisher with dependencies ready. Stop only owned MinIO and confirm /live stays 200 while readiness returns 503. Restart MinIO and wait for readiness to recover. Stop the owned Tools process and confirm the shutdown log and exit code 0. Treat /health/tower as a separate heartbeat check. | services/tools/app/routes/live.ts; services/tools/app/routes/health.ts; services/tools/app/routes/health/$component.ts; services/tools/platform/route-handlers.ts; services/tools/app/server.ts; services/tools/test/products/dashboard/app.test.ts; services/tools/test/products/publisher/publisher-runtime-shutdown.test.ts | Disposable stack only. Compose health checks /live only. Restore dependencies before later journeys. |

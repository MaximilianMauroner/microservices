# Status

| ID | Public actions and observable result | Source and existing checks | Prerequisites and reset |
| --- | --- | --- | --- |
| S1 | Open /status. Follow internal, external, and Open Tools links. Send a heartbeat with the local bearer token to an owned monitor, then observe updated status. Check a bad token is denied. Do not probe production endpoints. | src/routes/status.tsx; src/routes/api/status/heartbeats/$monitorId.ts; test/status-links.test.tsx; test/heartbeats.test.ts | Owned monitor and local targets; wait for bounded local scheduling. Remove monitor state. |

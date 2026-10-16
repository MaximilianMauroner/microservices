# Network Console

| ID | Public actions and observable result | Source and existing checks | Prerequisites and reset |
| --- | --- | --- | --- |
| N1 | GET Network Console health, then open its dashboard and GET /api/ports. The JSON has a fresh generatedAt, hostname, Tailscale state, listeners, and discovered sites. The owned listener is loopback-only with no remote target. Compare dashboard sections with JSON. Reload and check a fresh snapshot. | services/network-console/src/local-network.ts; service tests | Owned server on an unused loopback port. Stop its terminal session. Host details stay private. |

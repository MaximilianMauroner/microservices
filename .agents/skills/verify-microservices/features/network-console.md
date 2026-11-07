# Network Console

| ID | Public actions and observable result | Source and existing checks | Prerequisites and reset |
| --- | --- | --- | --- |
| N1 | GET /health, then open the dashboard and GET /api/ports. Check `ports` and `websites`, the Tailscale fields, and the loopback-only owned listener with no remote targets in JSON. The dashboard omits its own port from Other listeners. `websites` can be empty when no public Tailscale host exists. Check a changed `generatedAt` only after the five-second cache expires. A request with an unaccepted Host returns 421. | services/network-console/src/server.ts; services/network-console/src/local-network.ts; services/network-console/test/local-network.test.ts | Start the owned server on an unused loopback port. Stop its terminal session. Keep host details private. |

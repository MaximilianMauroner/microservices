# Operations

Drive the real user paths and verify the saved result.

## Sub-features

- O1. GET /live, /health, and documented component-health routes with dependencies ready. Stop only an owned dependency and verify readiness fails while liveness remains meaningful. Restart, require readiness, then stop the owned web process and confirm shutdown.

## How to get to it (user POV)

Open `/live` on the owned Tools origin. Publisher also has the native Fleet
upload CLI and canonical `/artifacts/` and `/files/` links.

## Driving it with T3 preview and the native CLI

Preconditions:

- The Tools doctor passes for this run's state directory.
- Private pages require an authorized local OAuth client and subject.
- Use the actions, expected results, and additional prerequisites below.

| ID | Public actions and observable result | Source and existing checks | Prerequisites and reset |
| --- | --- | --- | --- |
| O1 | GET /live, /health, and documented component-health routes with dependencies ready. Stop only an owned dependency and verify readiness fails while liveness remains meaningful. Restart, require readiness, then stop the owned web process and confirm shutdown. | src/routes/live.ts; src/routes/health/$component.ts; test/start.test.ts; test/publisher-runtime-shutdown.test.ts | Disposable stack only. Restore dependencies before subsequent journeys. |

## Gotchas

Unavailable prerequisites mean blocked. A different entry point does not prove
an unrun path. Keep captures after cleanup. Use no production endpoint.

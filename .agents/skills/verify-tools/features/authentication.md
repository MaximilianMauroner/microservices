# Authentication

Drive the real user paths and verify the saved result.

## Sub-features

- A1. Open /publisher in a clean browser. It leads to sign-in. Sign in with the allowed local Google subject; return to the private page. Sign out and verify access is removed. An unauthorized subject does not gain access.

## How to get to it (user POV)

Open `/publisher` on the owned Tools origin. Publisher also has the native Fleet
upload CLI and canonical `/artifacts/` and `/files/` links.

## Driving it with T3 preview and the native CLI

Preconditions:

- The Tools doctor passes for this run's state directory.
- Private pages require an authorized local OAuth client and subject.
- Use the actions, expected results, and additional prerequisites below.

| ID | Public actions and observable result | Source and existing checks | Prerequisites and reset |
| --- | --- | --- | --- |
| A1 | Open /publisher in a clean browser. It leads to sign-in. Sign in with the allowed local Google subject; return to the private page. Sign out and verify access is removed. An unauthorized subject does not gain access. | services/tools/src/routes/sign-in.tsx; test/auth.test.ts; test/auth-ui.test.tsx | Local OAuth and isolated PostgreSQL. Use two owned browser sessions; sign out both. |

## Gotchas

Unavailable prerequisites mean blocked. A different entry point does not prove
an unrun path. Keep captures after cleanup. Use no production endpoint.

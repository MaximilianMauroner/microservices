# Settings

Drive the real user paths and verify the saved result.

## Sub-features

- C1. Open Settings, exercise the available theme controls, reload, and verify persistence. Repeat navigation at 1280x800 and 390x844 in both themes, including mobile menu open/close. No horizontal document overflow or uncaught browser errors.

## How to get to it (user POV)

Open `/settings` on the owned Tools origin. Publisher also has the native Fleet
upload CLI and canonical `/artifacts/` and `/files/` links.

## Driving it with T3 preview and the native CLI

Preconditions:

- The Tools doctor passes for this run's state directory.
- Private pages require an authorized local OAuth client and subject.
- Use the actions, expected results, and additional prerequisites below.

| ID | Public actions and observable result | Source and existing checks | Prerequisites and reset |
| --- | --- | --- | --- |
| C1 | Open Settings, exercise the available theme controls, reload, and verify persistence. Repeat navigation at 1280x800 and 390x844 in both themes, including mobile menu open/close. No horizontal document overflow or uncaught browser errors. | src/routes/settings.tsx; test/product-accent.test.tsx; test/sidebar-navigation-contract.test.ts | A1 session and real loaded pages. Restore browser preferences and sign out. |

## Gotchas

Unavailable prerequisites mean blocked. A different entry point does not prove
an unrun path. Keep captures after cleanup. Use no production endpoint.

# Dashboard

Drive the real user paths and verify the saved result.

## Sub-features

- D1. Open Dashboard after sign-in, expand Infrastructure, navigate to each product, and return. Verify service outages, expiring Markdown, Money review, and unread Feedback appear when created in owned state. Expiring Publisher files do not add attention.

## How to get to it (user POV)

Open `/` on the owned Tools origin. Publisher also has the native Fleet
upload CLI and canonical `/artifacts/` and `/files/` links.

## Driving it with T3 preview and the native CLI

Preconditions:

- The Tools doctor passes for this run's state directory.
- Private pages require an authorized local OAuth client and subject.
- Use the actions, expected results, and additional prerequisites below.

| ID | Public actions and observable result | Source and existing checks | Prerequisites and reset |
| --- | --- | --- | --- |
| D1 | Open Dashboard after sign-in, expand Infrastructure, navigate to each product, and return. Verify service outages, expiring Markdown, Money review, and unread Feedback appear when created in owned state. Expiring Publisher files do not add attention. | dashboard/ui/tools-directory.tsx; test/dashboard-attention.test.ts; test/public-pages.test.tsx | Owned product records and local monitor definitions. Restore records. |

## Gotchas

Unavailable prerequisites mean blocked. A different entry point does not prove
an unrun path. Keep captures after cleanup. Use no production endpoint.

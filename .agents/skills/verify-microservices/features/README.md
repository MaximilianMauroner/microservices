# Feature coverage

Journeys describe required outcomes. A procedure is not a product pass. Record
execution status for each journey in the private audit evidence.

| Feature | Journeys | Coverage |
| --- | --- | --- |
| [Network Console](network-console.md) | N1 | Partial: live evidence required |
| [Authentication](authentication.md) | A1 | Partial: live evidence required |
| [Dashboard](dashboard.md) | D1 | Partial: live evidence required |
| [Status](status.md) | S1 | Partial: live evidence required |
| [Publisher](publisher.md) | P1, P2, P3, P4, P5, P6 | Partial: live evidence required |
| [Document Share](document-share.md) | M1, M2, M3 | Partial: live evidence required |
| [Feedback](feedback.md) | F1, F2, F3 | Partial: live evidence required |
| [Money](money.md) | W1, W2 | Partial: live evidence required |
| [Settings](settings.md) | C1 | Partial: live evidence required |
| [Operations](operations.md) | O1 | Partial: live evidence required |

Authenticated Tools journeys need disposable PostgreSQL, storage, encryption,
and authorized local OAuth. Document Share also needs a disposable Convex
backend. Retention needs a bounded local clock. Record unavailable setup as
blocked and unselected journeys as unrun.

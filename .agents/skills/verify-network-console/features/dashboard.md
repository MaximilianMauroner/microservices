# Dashboard and listeners

Network Console shows this machine's listeners and reachable services.

## Sub-features

- N1 shows the dashboard, health, and current port snapshot.
- N2 refreshes the snapshot without changing the installed service.

## How to get to it (user POV)

Open `http://127.0.0.1:43127/` in the browser.

## Driving it with T3 preview and HTTP

Preconditions:

- The owned server's doctor passes.

1. GET `/health` with `curl -fsS`. Expect `{"ok":true}`.
2. GET `/api/ports`. Save the JSON and confirm `generatedAt`, `hostname`,
   Tailscale state, listeners, and discovered sites.
3. Open `/` with T3 preview. Capture the heading and service sections. Compare
   their entries with the JSON. The owned loopback listener has no remote target.
4. Reload the page and GET `/api/ports` again. Confirm a fresh `generatedAt`.

## Gotchas

If `ss` is unavailable on the host, process details can be absent.
Do not invent listeners or replace the scanner to make the page look full. Host and network details stay
in private evidence. Do not follow production or unrelated service links.

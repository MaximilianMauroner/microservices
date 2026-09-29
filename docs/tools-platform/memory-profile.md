# Tools web memory profile

Measured locally on 2026-09-28 with Node.js 24.13.1. Both runs used the same
production build command and read-only local placeholder configuration. No
production services or data were used. The process was started directly with
`node --expose-gc --inspect` and had no child processes.

Read-only Railway metrics for the deployed `tools-web` container over the most
recent three hours reported 0.180 GB minimum, 0.433 GB average, and 0.549 GB
maximum memory across 180 samples. Railway reported the service as sleeping
when queried. These aggregate samples do not identify idle versus loaded
requests or distinguish Node heap from other container memory.

The baseline used Nitro `inlineDynamicImports: true`; the changed build used
`false`. Each process served `/live`, `/markdown`, `/sign-in`, and
`/feedback/confirmation`. The load was 1,500 completed requests at 20-way
concurrency, with the four routes equally represented. RSS peak was sampled
from `/proc/<pid>/status` every 10 ms. Post-load heap figures were collected
after V8 GC through the local inspector.

| Metric | Inline baseline | Split build |
| --- | ---: | ---: |
| Idle RSS after startup and GC | 146.5 MiB | 56.3 MiB |
| Peak RSS during 1,500 requests | 291.5 MiB | 225.8 MiB |
| RSS after load and GC | 161.0 MiB | 119.4 MiB |
| Live JS heap after load and GC | 24.7 MiB | 28.9 MiB |
| External memory after load and GC | 22.2 MiB | 7.2 MiB |
| Failed load requests | 0 | 0 |

The original single server bundle was 9.6 MB of JavaScript. Splitting it left
unused route and dependency chunks unloaded at idle. The RSS reduction exceeds
the external-memory reduction, so native code and module loading also contribute;
the profile does not assign every native byte to a package.

The local run had no MinIO or seeded Tools data, so it did not exercise artifact
transfers, authenticated pages, database queries, or scheduled work. The local
before/after numbers are process measurements, not Railway container
measurements. Check Railway container memory after deployment under comparable
traffic before using the local reduction for capacity limits.

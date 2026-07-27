# Service and repository rename runbook

The source layout uses these settled component names:

| Previous name | Current name |
| --- | --- |
| `html-publisher` | `artifact-publisher` |
| `field-guide-review` | `field-guide-console` |
| `tailscale-port-dashboard` | `network-console` |
| `uptime-monitor` | `tools-web` + `tools-checker` |

Rename Railway display names separately from service IDs, volumes/buckets,
variables, and stable domains. A display rename must not create a replacement
service. Verify health and deployment history after each rename before moving
to the next one.

## External evidence gates

The source rename is complete only after each external gate has an owner,
timestamp, before/after identifier, verification result, and rollback reference:

- **Railway:** service display names match the table above; source roots and
  config paths match the root README; existing service IDs, bucket attachment,
  variables, domains, and deployment history are unchanged.
- **Local VM/systemd:** the previous port-dashboard unit is stopped and disabled,
  `network-console.service` is installed from the candidate checkout, its
  Tailscale-only `/health` succeeds, and the previous unit file remains available
  for rollback.
- **GitHub:** repository rename from `microservices` to `tools-platform` is a
  separately approved external operation. Record the old/new clone URLs,
  redirect behavior, updated Railway source linkage, status checks, local
  remotes, and rollback owner before performing it.

Repository files and this runbook are preparation, not evidence that any of
these external changes have happened.

Keep user-facing URLs stable. `uploads.mauroner.eu` remains the intended
Artifact Publisher URL, but it was unresolved during planning and must not be
presented as live until DNS is fixed and tested. The Network Console remains a
local/Tailscale service rather than moving to Railway.

The GitHub repository remains `MaximilianMauroner/microservices` until the
separate evidence gate above is approved. A repository rename affects clone
URLs, Railway source linkage, status checks, and documentation.
Search for stale names before release:

```bash
rg -n "html-publisher|field-guide-review|tailscale-port-dashboard|uptime-monitor" \
  --glob '!docs/tools-platform/rename-migration.md'
```

Historical migration documentation may intentionally mention prior names.

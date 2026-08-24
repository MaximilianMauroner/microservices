# Feedback

Feedback is a product inside the Mauroner Tools runtime. The owner manages forms
and responses through the existing Better Auth Google session at `/feedback`.
Respondents use an unlisted capability URL at `/feedback/f/:token` without an
account.

PostgreSQL owns forms and responses in the `tools` schema. The application does
not persist respondent IP addresses, user agents, referrers, or cookies with a
response. Infrastructure may still keep ordinary request logs, so public copy
must not promise complete anonymity.

Run focused checks from the repository root:

```bash
pnpm --dir services/tools test -- feedback
pnpm --dir services/tools run typecheck
```

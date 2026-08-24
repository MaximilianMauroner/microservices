# Feedback

Feedback is a product inside the Mauroner Tools runtime. The owner manages forms
and responses through the existing Better Auth Google session at `/feedback`.
Respondents use an unlisted capability URL at `/feedback/f/:token` without an
account.

Each form is written in either German or English. Public forms do not show a
language switch. New forms start as empty drafts after the owner selects one
language. The optional identity question can be removed per form. Existing
submissions keep their question snapshot when the form changes later.

The private form editor can copy a versioned JSON document containing the form
content and response schema. It can also copy a generation prompt or apply a
pasted schema document before saving. New copies use the single-language
version 2 format, while legacy version 1 documents still import as English.
JSON imports may add, remove, or
reorder up to 20 `choice`, `short_text`, and `long_text` questions. Question
IDs become stable response keys and must remain unique lowercase identifiers.
The generation prompt asks whether the form should be German or English before
it produces JSON.

PostgreSQL owns forms and responses in the `tools` schema. The application does
not persist respondent IP addresses, user agents, referrers, or cookies with a
response. Infrastructure may still keep ordinary request logs, so public copy
must not promise complete anonymity.

Run focused checks from the repository root:

```bash
pnpm --dir services/tools test -- feedback
pnpm --dir services/tools run typecheck
```

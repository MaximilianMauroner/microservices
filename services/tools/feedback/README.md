# Feedback

Feedback is a product inside the Mauroner Tools runtime. The owner manages forms
and responses through the existing Better Auth Google session at `/feedback`.
Respondents use an unlisted capability URL at `/feedback/f/:token` without an
account.

Each form stores English source text and an editable German translation. Public
forms use `?lang=en` or `?lang=de` and show a language switch. The optional
identity question can be removed per form. Existing submissions keep their
localized question snapshot when the form changes later.

The private form editor can copy a versioned JSON document containing the form
content and response schema. It can also copy a translation prompt or apply a
pasted version 1 document before saving. JSON imports may add, remove, or
reorder up to 20 `choice`, `short_text`, and `long_text` questions. Question
IDs become stable response keys and must remain unique lowercase identifiers.

PostgreSQL owns forms and responses in the `tools` schema. The application does
not persist respondent IP addresses, user agents, referrers, or cookies with a
response. Infrastructure may still keep ordinary request logs, so public copy
must not promise complete anonymity.

Run focused checks from the repository root:

```bash
pnpm --dir services/tools test -- feedback
pnpm --dir services/tools run typecheck
```

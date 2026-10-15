# Feedback

Drive the real user paths and verify the saved result.

## Sub-features

- F1. Create a Feedback form, add required questions, publish it, and open the public token URL without a session. Submit invalid then valid data. See the confirmation and exactly one response. Mark it read, inspect its details, export it, and use its share link. Revoke sharing and verify denial.
- F2. Create German and English forms and confirm each public form has its selected language with no language switch. Copy and reapply a version-2 schema; import a documented legacy version-1 fixture as English. Reject invalid or duplicate question IDs. Exercise unsaved-change protection.
- F3. Add follow-up and meeting questions. A selection without contact details fails; valid contact enters the follow-up queue. Submit choice details, edit the form, and confirm the old response retains its original question snapshot and exported details. Create respondent share links for supported lifetimes; revoke or delete and verify access denial.

## How to get to it (user POV)

Open `/feedback` on the owned Tools origin. Publisher also has the native Fleet
upload CLI and canonical `/artifacts/` and `/files/` links.

## Driving it with T3 preview and the native CLI

Preconditions:

- The Tools doctor passes for this run's state directory.
- Private pages require an authorized local OAuth client and subject.
- Use the actions, expected results, and additional prerequisites below.

| ID | Public actions and observable result | Source and existing checks | Prerequisites and reset |
| --- | --- | --- | --- |
| F1 | Create a Feedback form, add required questions, publish it, and open the public token URL without a session. Submit invalid then valid data. See the confirmation and exactly one response. Mark it read, inspect its details, export it, and use its share link. Revoke sharing and verify denial. | feedback/README.md; src/routes/feedback; test/feedback-public-handler.test.ts; test/feedback-export.test.ts | Isolated PostgreSQL and local encryption configuration. Delete owned submissions and form. Keep exports private. |
| F2 | Create German and English forms and confirm each public form has its selected language with no language switch. Copy and reapply a version-2 schema; import a documented legacy version-1 fixture as English. Reject invalid or duplicate question IDs. Exercise unsaved-change protection. | feedback/README.md; test/feedback-schema-exchange.test.ts; test/feedback-question-editor.test.tsx | Owned forms, public sessions, and private schema captures. Delete forms and captures after evidence retention. |
| F3 | Add follow-up and meeting questions. A selection without contact details fails; valid contact enters the follow-up queue. Submit choice details, edit the form, and confirm the old response retains its original question snapshot and exported details. Create respondent share links for supported lifetimes; revoke or delete and verify access denial. | feedback/README.md; test/feedback-domain.test.ts; test/feedback-inbox.test.tsx; test/feedback-export.test.ts | Owned responses and stable local encryption key. Delete responses and forms; retain redacted evidence. |

## Gotchas

Unavailable prerequisites mean blocked. A different entry point does not prove
an unrun path. Keep captures after cleanup. Use no production endpoint.

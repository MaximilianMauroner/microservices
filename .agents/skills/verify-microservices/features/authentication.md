# Authentication

| ID | Public actions and observable result | Source and existing checks | Prerequisites and reset |
| --- | --- | --- | --- |
| A1 | Open /publisher in a clean browser. It leads to sign-in. The admin must match both the configured Google subject and the fixed admin email. An invited member binds their email to a Google subject at first sign-in. Return to the private page, sign out, and verify access is removed. An uninvited account gets no session. A signed-in member without Publisher access goes to their home path, not sign-in. | services/tools/app/routes/sign-in.tsx; services/tools/platform/auth/auth.ts; services/tools/platform/auth/session.ts; services/tools/platform/gateway.ts; services/tools/test/platform/auth/auth.test.ts; services/tools/test/platform/auth/auth-ui.test.tsx | Local OAuth, isolated PostgreSQL, an admin account, an invited member, and an uninvited account. Use owned browser sessions and sign out all accounts. |

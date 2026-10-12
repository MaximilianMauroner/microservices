# Authentication

| ID | Public actions and observable result | Source and existing checks | Prerequisites and reset |
| --- | --- | --- | --- |
| A1 | Open /publisher in a clean browser. It leads to sign-in. Sign in with the allowed local Google subject; return to the private page. Sign out and verify access is removed. An unauthorized subject does not gain access. | services/tools/src/routes/sign-in.tsx; test/auth.test.ts; test/auth-ui.test.tsx | Local OAuth and isolated PostgreSQL. Use two owned browser sessions; sign out both. |

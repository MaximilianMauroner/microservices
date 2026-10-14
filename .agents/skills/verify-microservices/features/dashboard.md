# Dashboard

| ID | Public actions and observable result | Source and existing checks | Prerequisites and reset |
| --- | --- | --- | --- |
| D1 | Open Dashboard after sign-in, expand Infrastructure, navigate to each product, and return. Verify service outages, expiring Markdown, Money review, and unread Feedback appear when created in owned state. Expiring Publisher files do not add attention. | dashboard/ui/tools-directory.tsx; test/dashboard-attention.test.ts; test/public-pages.test.tsx | Owned product records and local monitor definitions. Restore records. |

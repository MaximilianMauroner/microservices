# Settings

| ID | Public actions and observable result | Source and existing checks | Prerequisites and reset |
| --- | --- | --- | --- |
| C1 | Open Settings, exercise the available theme controls, reload, and verify persistence. Repeat navigation at 1280x800 and 390x844 in both themes, including mobile menu open/close. No horizontal document overflow or uncaught browser errors. | src/routes/settings.tsx; test/product-accent.test.tsx; test/sidebar-navigation-contract.test.ts | A1 session and real loaded pages. Restore browser preferences and sign out. |

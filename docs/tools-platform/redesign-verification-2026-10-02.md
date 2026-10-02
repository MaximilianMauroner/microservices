# Tools redesign verification

Both requested behaviors are present on main at
`bad387e28f86bba44de2968eb2fa79ade8815fc3`.
The redesign commits `e8ecf77`, `c86bbff`, and `f1f6893` are ancestors of that
revision. No layout change was needed. The browser check found a separate
Status link error, fixed by setting `nativeButton={false}` on its two link
button call sites.

## Dashboard attention

`services/tools/src/attention.ts` reads the Publisher inventory summary but
uses only its total in Dashboard facts. File expiry does not enter the attention
summary. `needsItems` in `services/tools/dashboard/ui/tools-directory.tsx`
contains service outages, Markdown document expiry, Money review, and unread
Feedback. It has no Publisher file item.

`test/dashboard-attention.test.ts` supplies 142 artifacts, including 50 expiring
files. The loader retains the artifact count and returns no file attention.
The existing `test/public-pages.test.tsx` checks the rendered list. Markdown
document expiry remains in that list, as specified by the existing test.

## Browser checks

The T3 collaborative browser rendered the real React page components, styles,
ThemeProvider, SidebarProvider, ToolsSidebar, and AppShell. An isolated local
Vite harness supplied synthetic fixtures from the existing page tests. It
mocked router hooks, authentication, server functions, and the upload-link
inventory. It did not use a database, OAuth, production configuration, or
production data.

Each row passed at 1280 × 800 and 390 × 844 CSS pixels in both themes. Each
case had `document.documentElement.scrollWidth <= clientWidth`, a rendered
page heading, and no page exceptions, rejected promises, or console errors
after the Status fix. Money's phone tabs scroll inside their own container.
Vertical desktop-browser scrollbars reduce `clientWidth` by 15 pixels where
the page is taller than the viewport.

| Page | 1280 dark | 1280 light | 390 dark | 390 light |
| --- | --- | --- | --- | --- |
| Dashboard | Passed | Passed | Passed | Passed |
| Status | Passed | Passed | Passed | Passed |
| Documents | Passed | Passed | Passed | Passed |
| Publisher: Publish | Passed | Passed | Passed | Passed |
| Publisher: Library | Passed | Passed | Passed | Passed |
| Publisher: Receive files | Passed | Passed | Passed | Passed |
| Feedback: Forms | Passed | Passed | Passed | Passed |
| Feedback: Responses | Passed | Passed | Passed | Passed |
| Feedback: Form editor | Passed | Passed | Passed | Passed |
| Feedback: Response | Passed | Passed | Passed | Passed |
| Settings | Passed | Passed | Passed | Passed |
| Money: Overview | Passed | Passed | Passed | Passed |
| Money: Spending | Passed | Passed | Passed | Passed |
| Money: Transactions | Passed | Passed | Passed | Passed |
| Money: Accounts | Passed | Passed | Passed | Passed |
| Money: Investments | Passed | Passed | Passed | Passed |
| Money: Plan | Passed | Passed | Passed | Passed |
| Money: Review | Passed | Passed | Passed | Passed |

The Dashboard also fit at 390 pixels with Infrastructure expanded. Its mobile
navigation opened within the viewport and closed with Escape without errors.

The Status error was reproduced before the fix in the browser and in
`test/status-links.test.tsx`. That test now passes for internal, external, and
Open Tools links.

## Limits

These checks establish rendering with the tested synthetic fixtures. They do
not establish live authentication, SSR hydration, storage integration, native
phone-browser behavior, or product acceptance. No deployment or merge was
performed.

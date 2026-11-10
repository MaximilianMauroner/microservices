import { createFileRoute } from "@tanstack/react-router";
import { requireRouteSession } from "../../platform/auth/session.js";
import { getDevFeedback } from "../../platform/dev-feedback/server-functions.js";
import { ReportsInbox } from "../../platform/dev-feedback/dev-feedback-ui.js";
import { AppShell } from "../../platform/ui/components/app-shell.js";
import { PageHeader } from "../../platform/ui/components/page-header.js";

export const Route = createFileRoute("/reports")({
  beforeLoad: ({ location }) => requireRouteSession(location.href),
  loader: () => getDevFeedback(),
  head: () => ({ meta: [{ title: "Reports — Mauroner Tools" }] }),
  component: ReportsPage
});

function ReportsPage() {
  const { reports, reportsUrl } = Route.useLoaderData();
  return <>
    <AppShell product="Reports" />
    <main id="main" className="tools-page">
      <PageHeader title="Reports" facts="Bug reports and ideas from every app" />
      <ReportsInbox items={reports} reportsUrl={reportsUrl} />
    </main>
  </>;
}

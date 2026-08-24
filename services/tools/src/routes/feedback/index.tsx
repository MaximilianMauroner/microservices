import { createFileRoute } from "@tanstack/react-router";
import { FeedbackHome } from "../../../feedback/ui.js";
import { getFeedbackForms } from "../../../feedback/server-functions.js";
import { requireRouteSession } from "../../auth-session.js";

export const Route = createFileRoute("/feedback/")({
  beforeLoad: ({ location }) => requireRouteSession(location.href),
  loader: () => getFeedbackForms(),
  component: () => <FeedbackHome forms={Route.useLoaderData()} />
});

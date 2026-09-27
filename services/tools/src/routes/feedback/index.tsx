import { createFileRoute } from "@tanstack/react-router";
import { FeedbackInbox } from "../../../feedback/ui.js";
import { getFeedbackInbox } from "../../../feedback/server-functions.js";
import { requireRouteSession } from "../../auth-session.js";

export const Route = createFileRoute("/feedback/")({
  beforeLoad: ({ location }) => requireRouteSession(location.href),
  loader: () => getFeedbackInbox(),
  component: () => <FeedbackInbox {...Route.useLoaderData()} />
});

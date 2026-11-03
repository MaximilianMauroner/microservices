import { createFileRoute } from "@tanstack/react-router";
import { FeedbackInbox } from "../../../feedback/ui.js";
import { getFeedbackInbox } from "../../../feedback/server-functions.js";
import { requireProductSession } from "../../auth-session.js";

export const Route = createFileRoute("/feedback/")({
  beforeLoad: ({ location }) => requireProductSession(location.href, "feedback"),
  loader: () => getFeedbackInbox(),
  component: () => <FeedbackInbox {...Route.useLoaderData()} />
});

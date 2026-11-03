import { createFileRoute } from "@tanstack/react-router";
import { FeedbackHome } from "../../../../products/feedback/ui.js";
import { getFeedbackForms } from "../../../../products/feedback/server-functions.js";
import { requireProductSession } from "../../../../platform/auth/session.js";

export const Route = createFileRoute("/feedback/forms/")({
  beforeLoad: ({ location }) => requireProductSession(location.href, "feedback"),
  loader: () => getFeedbackForms(),
  component: () => <FeedbackHome forms={Route.useLoaderData()} />
});

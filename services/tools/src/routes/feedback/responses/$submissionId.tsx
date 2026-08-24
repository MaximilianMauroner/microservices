import { createFileRoute } from "@tanstack/react-router";
import { FeedbackResponsePage } from "../../../../feedback/ui.js";
import { getFeedbackSubmission } from "../../../../feedback/server-functions.js";
import { requireRouteSession } from "../../../auth-session.js";

export const Route = createFileRoute("/feedback/responses/$submissionId")({
  beforeLoad: ({ location }) => requireRouteSession(location.href),
  loader: ({ params }) => getFeedbackSubmission({ data: { submissionId: params.submissionId } }),
  component: () => <FeedbackResponsePage submission={Route.useLoaderData()} />
});

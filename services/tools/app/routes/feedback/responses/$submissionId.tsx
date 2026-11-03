import { createFileRoute } from "@tanstack/react-router";
import { FeedbackResponsePage } from "../../../../products/feedback/ui.js";
import { getFeedbackSubmission } from "../../../../products/feedback/server-functions.js";
import { requireProductSession } from "../../../../platform/auth/session.js";

export const Route = createFileRoute("/feedback/responses/$submissionId")({
  beforeLoad: ({ location }) => requireProductSession(location.href, "feedback"),
  loader: ({ params }) => getFeedbackSubmission({ data: { submissionId: params.submissionId } }),
  component: () => <FeedbackResponsePage submission={Route.useLoaderData()} />
});

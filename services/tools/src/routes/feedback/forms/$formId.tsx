import { createFileRoute } from "@tanstack/react-router";
import { FeedbackFormPage } from "../../../../feedback/ui.js";
import { getFeedbackFormPage } from "../../../../feedback/server-functions.js";
import { requireProductSession } from "../../../auth-session.js";

export const Route = createFileRoute("/feedback/forms/$formId")({
  beforeLoad: ({ location }) => requireProductSession(location.href, "feedback"),
  loader: ({ params }) => getFeedbackFormPage({ data: { formId: params.formId } }),
  component: () => <FeedbackFormPage {...Route.useLoaderData()} />
});

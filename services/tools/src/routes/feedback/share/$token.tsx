import { createFileRoute } from "@tanstack/react-router";
import { SharedFeedbackResponsePage } from "../../../../feedback/public-page.js";
import { getSharedFeedbackResponse } from "../../../../feedback/server-functions.js";

export const Route = createFileRoute("/feedback/share/$token")({
  loader: ({ params }) => getSharedFeedbackResponse({ data: { token: params.token } }),
  head: () => ({ meta: [{ title: "Shared feedback" }, { name: "robots", content: "noindex, nofollow" }, { name: "referrer", content: "no-referrer" }] }),
  component: SharedRoute,
});

function SharedRoute() {
  const response = Route.useLoaderData();
  if (!response) return <main className="mx-auto w-[min(620px,calc(100%_-_2rem))] py-20"><h1 className="text-2xl font-semibold">Link unavailable</h1><p className="mt-3 text-muted-foreground">This response link has expired or is invalid.</p></main>;
  return <SharedFeedbackResponsePage response={response} />;
}

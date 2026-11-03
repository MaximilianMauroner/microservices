import { createFileRoute } from "@tanstack/react-router";
import { FeedbackConfirmationPage } from "../../../products/feedback/public-page.js";
import { parsePublicFeedbackSearch } from "../../../products/feedback/public-search.js";

export const Route = createFileRoute("/feedback/confirmation")({
  validateSearch: parsePublicFeedbackSearch,
  head: () => ({ meta: [{ title: "Feedback sent" }, { name: "robots", content: "noindex, nofollow" }, { name: "referrer", content: "no-referrer" }] }),
  component: ConfirmationRoute,
});

function ConfirmationRoute() {
  const search = Route.useSearch();
  return <FeedbackConfirmationPage locale={search.locale ?? "en"} shareUrl={search.share ? `/feedback/share/${search.share}` : undefined} shareExpiresAt={search.expires} />;
}

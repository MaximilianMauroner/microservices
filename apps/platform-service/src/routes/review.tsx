import { createFileRoute } from "@tanstack/react-router";
import { ReviewPage, type ReviewSearch } from "../components/review-page.js";
import { getReviewPageData } from "../protected-data.js";
import { fieldGuide } from "../route-handlers.js";

export const Route = createFileRoute("/review")({
  validateSearch: (search): ReviewSearch => ({
    scope: search.scope === "global" ? "global" : "project",
    view: search.view === "queue" || search.view === "history" ? search.view : "decisions",
    reviewState: search.reviewState === "reviewed" || search.reviewState === "all" ? search.reviewState : "unreviewed",
    ...optionalSearch(search, "projectKey"),
    ...optionalSearch(search, "taskId"),
    ...optionalSearch(search, "device"),
    ...optionalSearch(search, "harness"),
    ...optionalSearch(search, "skill"),
    ...optionalSearch(search, "from"),
    ...optionalSearch(search, "to")
  }),
  loaderDeps: ({ search }) => ({
    scope: search.scope,
    view: search.view,
    reviewState: search.reviewState,
    filters: {
      projectKey: search.projectKey,
      taskId: search.taskId,
      device: search.device,
      harness: search.harness,
      skill: search.skill,
      from: search.from,
      to: search.to
    }
  }),
  loader: ({ deps }) => getReviewPageData({ data: deps }),
  head: () => ({
    meta: [
      { title: "Review — Mauroner Tools" },
      { name: "description", content: "Protected field-guide review workspace." },
      { name: "robots", content: "noindex, nofollow" }
    ]
  }),
  component: ReviewRoute,
  server: { handlers: { HEAD: fieldGuide } }
});

function ReviewRoute() {
  return <ReviewPage initial={Route.useLoaderData()} search={Route.useSearch()} />;
}

function optionalSearch(search: Record<string, unknown>, key: string) {
  const value = search[key];
  return typeof value === "string" && value.trim() ? { [key]: value.trim() } : {};
}

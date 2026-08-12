import { createFileRoute } from "@tanstack/react-router";
import { ReviewPage, type ReviewSearch } from "../../field-guide/ui/review-page.js";
import { getReviewPageData } from "../protected-data.js";
import { faviconLink, favicons } from "../favicons.js";
import { requireRouteSession } from "../auth-session.js";

export const Route = createFileRoute("/field-guide")({
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
    ...optionalSearch(search, "to"),
    ...optionalSearch(search, "queueProject"),
    ...enumSearch(search, "queueKind", ["initial", "scheduled"] as const),
    ...enumSearch(search, "queueStatus", ["pending", "due", "overdue"] as const),
    ...optionalSearch(search, "queueQuery")
  }),
  beforeLoad: ({ location }) => requireRouteSession(location.href),
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
      { title: "Field Guide — Tools" },
      { name: "description", content: "Protected field-guide review workspace." },
      { name: "robots", content: "noindex, nofollow" }
    ],
    links: [faviconLink(favicons.fieldGuide)]
  }),
  component: ReviewRoute
});

function ReviewRoute() {
  return <ReviewPage initial={Route.useLoaderData()} search={Route.useSearch()} />;
}

function enumSearch<const Value extends string>(search: Record<string, unknown>, key: string, values: readonly Value[]) {
  const value = search[key];
  return typeof value === "string" && values.includes(value as Value) ? { [key]: value as Value } : {};
}

function optionalSearch(search: Record<string, unknown>, key: string) {
  const value = search[key];
  return typeof value === "string" && value.trim() ? { [key]: value.trim() } : {};
}

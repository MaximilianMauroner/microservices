import { createFileRoute } from "@tanstack/react-router";
import { getBodyshopDay } from "../../../products/bodyshop/server-functions.js";
import { TodayPage } from "../../../products/bodyshop/ui/today.js";

export const Route = createFileRoute("/bodyshop/")({
  validateSearch: (search: Record<string, unknown>): { day?: string } =>
    typeof search.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search.day) ? { day: search.day } : {},
  loaderDeps: ({ search }) => ({ day: search.day }),
  loader: ({ deps }) => getBodyshopDay({ data: { day: deps.day } }),
  component: () => <TodayPage data={Route.useLoaderData()} />
});

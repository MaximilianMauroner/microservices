import { createFileRoute } from "@tanstack/react-router";
import { getBodyshopProgress } from "../../../products/bodyshop/server-functions.js";
import { ProgressPage } from "../../../products/bodyshop/ui/progress.js";

export const Route = createFileRoute("/bodyshop/progress")({
  loader: () => getBodyshopProgress(),
  component: () => <ProgressPage data={Route.useLoaderData()} />
});

import { createFileRoute } from "@tanstack/react-router";
import { PublishPage } from "../../../publisher/ui/publish-page.js";

export const Route = createFileRoute("/publisher/")({
  component: PublishRoute
});

function PublishRoute() {
  return <PublishPage />;
}

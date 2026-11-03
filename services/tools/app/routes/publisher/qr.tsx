import { createFileRoute } from "@tanstack/react-router";
import { FamilyQrPage } from "../../../products/publisher/ui/family-qr-page.js";
import { getFamilyQrPageData } from "../../../platform/protected-data.js";

export const Route = createFileRoute("/publisher/qr")({
  loader: () => getFamilyQrPageData(),
  component: FamilyQrRoute
});

function FamilyQrRoute() {
  return <FamilyQrPage initial={Route.useLoaderData()} />;
}

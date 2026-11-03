import { createFileRoute } from "@tanstack/react-router";
import { getBodyshopSettings } from "../../../products/bodyshop/server-functions.js";
import { SettingsPage } from "../../../products/bodyshop/ui/settings.js";

export const Route = createFileRoute("/bodyshop/settings")({
  loader: () => getBodyshopSettings(),
  component: () => <SettingsPage data={Route.useLoaderData()} />
});

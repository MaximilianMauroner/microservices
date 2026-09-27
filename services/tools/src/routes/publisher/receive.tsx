import { createFileRoute } from "@tanstack/react-router";
import { ReceiveFilesPage } from "../../../publisher/ui/upload-link-manager.js";
import { requireRouteSession } from "../../auth-session.js";

export const Route = createFileRoute("/publisher/receive")({
  beforeLoad: ({ location }) => requireRouteSession(location.href),
  component: ReceiveFilesPage
});

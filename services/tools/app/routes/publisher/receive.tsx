import { createFileRoute } from "@tanstack/react-router";
import { ReceiveFilesPage } from "../../../products/publisher/ui/upload-link-manager.js";
import { requireProductSession } from "../../../platform/auth/session.js";

export const Route = createFileRoute("/publisher/receive")({
  beforeLoad: ({ location }) => requireProductSession(location.href, "publisher"),
  component: ReceiveFilesPage
});

import { createFileRoute } from "@tanstack/react-router";
import { ReceiveFilesPage } from "../../../publisher/ui/upload-link-manager.js";
import { requireProductSession } from "../../auth-session.js";

export const Route = createFileRoute("/publisher/receive")({
  beforeLoad: ({ location }) => requireProductSession(location.href, "publisher"),
  component: ReceiveFilesPage
});

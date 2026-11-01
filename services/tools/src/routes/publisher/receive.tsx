import { createFileRoute } from "@tanstack/react-router";
import { ReceiveFilesPage } from "../../../publisher/ui/upload-link-manager.js";

export const Route = createFileRoute("/publisher/receive")({
  component: ReceiveFilesPage
});

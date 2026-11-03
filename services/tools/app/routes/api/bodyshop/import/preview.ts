import { createFileRoute } from "@tanstack/react-router";
import { previewBodyshopImport } from "../../../../../products/bodyshop/route-handlers.js";

export const Route = createFileRoute("/api/bodyshop/import/preview")({
  server: { handlers: { POST: previewBodyshopImport } }
});

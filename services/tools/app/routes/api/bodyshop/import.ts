import { createFileRoute } from "@tanstack/react-router";
import { commitBodyshopImport } from "../../../../products/bodyshop/route-handlers.js";

export const Route = createFileRoute("/api/bodyshop/import")({
  server: { handlers: { POST: commitBodyshopImport } }
});

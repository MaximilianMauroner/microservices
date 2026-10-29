import { createFileRoute } from "@tanstack/react-router";
import type { PlatformRouteInput } from "../../../../route-handlers.js";

const handle = ({ request, context }: PlatformRouteInput) => context.runtime.documentShare.handle(request);
export const Route = createFileRoute("/api/share/documents/$")({
  server: { handlers: { GET: handle, POST: handle } }
});

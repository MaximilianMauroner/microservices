import { createFileRoute } from "@tanstack/react-router";
import { createMiddleware } from "@tanstack/react-start";
import { artifact } from "../../route-handlers.js";

export const uploadLinkPostMiddleware = createMiddleware().server(
  async ({ request, context, next }) => {
    if (
      request.method !== "POST" ||
      new URL(request.url).pathname !== "/api/upload-links"
    ) return next();
    return artifact({ request, context, params: {} });
  }
);

export const Route = createFileRoute("/api/upload-links")({
  server: {
    middleware: [uploadLinkPostMiddleware],
    handlers: { GET: artifact }
  }
});

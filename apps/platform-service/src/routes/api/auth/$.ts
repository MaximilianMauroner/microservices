import { createFileRoute } from "@tanstack/react-router";
import { getPlatformRuntime } from "../../../runtime.js";

async function authHandler({ request }: { request: Request }) {
  return (await getPlatformRuntime()).auth.handler(request);
}

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: authHandler,
      POST: authHandler
    }
  }
});

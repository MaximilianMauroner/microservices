import { createFileRoute } from "@tanstack/react-router";
import { handleReportSubmission } from "../../../platform/dev-feedback/http.js";
import { getPlatformRuntime } from "../../runtime.js";

async function submit({ request }: { request: Request }) {
  const runtime = await getPlatformRuntime();
  return handleReportSubmission(request, (one) => runtime.resolveAppToken(one, "pantrino"), runtime.devFeedback);
}

export const Route = createFileRoute("/api/reports")({
  server: { handlers: { POST: submit } }
});

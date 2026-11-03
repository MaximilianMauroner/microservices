import { createFileRoute } from "@tanstack/react-router";
import { exportFeedbackForm } from "../../../../../../products/feedback/private-handler.js";

export const Route = createFileRoute("/api/feedback/forms/$formId/export")({ server: { handlers: { GET: exportFeedbackForm } } });

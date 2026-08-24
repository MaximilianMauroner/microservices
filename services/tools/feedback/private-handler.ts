import type { PlatformRouteInput } from "../src/route-handlers.js";
import { feedbackCsv } from "./export.js";

export async function exportFeedbackForm({ context, params }: PlatformRouteInput) {
  if (!context.principal) return new Response(JSON.stringify({ error: "authentication_required" }), { status: 401, headers: { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" } });
  const form = await context.runtime.feedback.getForm(params.formId);
  if (!form) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });
  const csv = feedbackCsv(form, await context.runtime.feedback.listSubmissions(form.id));
  return new Response(csv, { headers: { "Cache-Control": "private, no-store", "Content-Disposition": `attachment; filename="feedback-${form.id}.csv"`, "Content-Type": "text/csv; charset=utf-8" } });
}

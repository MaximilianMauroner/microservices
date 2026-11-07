import { createServerFn, getGlobalStartContext } from "@tanstack/react-start";
import { requirePlatformSession, requireSignedInSession } from "../auth/middleware.js";
import { DEV_FEEDBACK_STATES, parseDevFeedback, type DevFeedbackState } from "./report.js";

function devFeedback() {
  const runtime = getGlobalStartContext()?.runtime;
  if (!runtime) throw new Error("Dev feedback runtime is unavailable.");
  return runtime.devFeedback;
}

/** Any signed-in person can report a bug or request a feature from any Tools page. Only the admin reads the reports. */
export const sendDevFeedback = createServerFn({ method: "POST" })
  .middleware([requireSignedInSession])
  .validator((input: { kind: string; message: string; details?: string; page: string }) => parseDevFeedback({ ...input, app: "tools" }))
  .handler(({ data, context }) => devFeedback().send(data, { subject: context.principal.subject, email: context.principal.email }));

export const getDevFeedback = createServerFn({ method: "GET" })
  .middleware([requirePlatformSession])
  .handler(async () => ({ reports: await devFeedback().list(), reportsUrl: `${getGlobalStartContext()!.runtime.publicOrigin}/reports` }));

export const setDevFeedbackState = createServerFn({ method: "POST" })
  .middleware([requirePlatformSession])
  .validator((input: { id: unknown; state: unknown }) => {
    if (!DEV_FEEDBACK_STATES.includes(input.state as DevFeedbackState)) throw new Error("Unknown report state.");
    return { id: String(input.id), state: input.state as DevFeedbackState };
  })
  .handler(async ({ data }) => {
    if (!await devFeedback().setState(data.id, data.state)) throw new Error("This report no longer exists.");
  });

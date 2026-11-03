import { createServerFn, getGlobalStartContext } from "@tanstack/react-start";
import { requirePlatformSession, requireSignedInSession } from "../auth/middleware.js";
import { parseDevFeedback } from "./dev-feedback.js";

function devFeedback() {
  const runtime = getGlobalStartContext()?.runtime;
  if (!runtime) throw new Error("Dev feedback runtime is unavailable.");
  return runtime.devFeedback;
}

/** Any signed-in person can report a bug or request a feature from any page. Only the admin reads the reports. */
export const sendDevFeedback = createServerFn({ method: "POST" })
  .middleware([requireSignedInSession])
  .validator((input: { kind: string; message: string; page: string }) => parseDevFeedback(input))
  .handler(({ data, context }) => devFeedback().send({ ...data, authorSubject: context.principal.subject, authorEmail: context.principal.email }));

export const getDevFeedback = createServerFn({ method: "GET" })
  .middleware([requirePlatformSession])
  .handler(() => devFeedback().list());

export const setDevFeedbackState = createServerFn({ method: "POST" })
  .middleware([requirePlatformSession])
  .validator((input: { id: unknown; state: unknown }) => ({ id: String(input.id), state: input.state === "done" ? "done" as const : "open" as const }))
  .handler(async ({ data }) => {
    if (!await devFeedback().setState(data.id, data.state)) throw new Error("This report no longer exists.");
  });

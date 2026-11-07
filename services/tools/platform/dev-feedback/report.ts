export const REPORT_APPS = { tools: "Tools", pantrino: "Pantrino", dotally: "Dotally" } as const;
export type ReportApp = keyof typeof REPORT_APPS;
export const DEV_FEEDBACK_KINDS = ["bug", "feature"] as const;
export type DevFeedbackKind = (typeof DEV_FEEDBACK_KINDS)[number];
/** `tracked` means the admin opened a GitHub issue for the report. */
export const DEV_FEEDBACK_STATES = ["open", "tracked", "done"] as const;
export type DevFeedbackState = (typeof DEV_FEEDBACK_STATES)[number];

/** `details` holds what the sender adds on request: how to make a bug happen again, or why an idea helps. */
export type DevFeedbackInput = Readonly<{ app: ReportApp; kind: DevFeedbackKind; message: string; details?: string; page: string; context?: string; contactEmail?: string }>;
/** Who sent a report. An anonymous report has no account and may leave an email to reply to. */
export type DevFeedbackAuthor = Readonly<{ subject: string; email: string }> | undefined;

/** A bug report or an idea about one of the apps, sent to the developer. */
export type DevFeedback = Readonly<{
  id: string; app: ReportApp; kind: DevFeedbackKind; message: string; details?: string; page: string; context?: string;
  authorEmail?: string; contactEmail?: string; state: DevFeedbackState; createdAt: string;
}>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseDevFeedback(input: { app?: unknown; kind: unknown; message: unknown; details?: unknown; page: unknown; context?: unknown; contactEmail?: unknown }): DevFeedbackInput {
  const app = input.app ?? "tools";
  if (typeof app !== "string" || !Object.hasOwn(REPORT_APPS, app)) throw new Error("This app does not take reports.");
  if (!DEV_FEEDBACK_KINDS.includes(input.kind as DevFeedbackKind)) throw new Error("Choose a bug report or a feature request.");
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (!message) throw new Error("Write what happened or what you would like.");
  if (message.length > 4000) throw new Error("Keep the message under 4000 characters.");
  const details = typeof input.details === "string" ? input.details.trim() : "";
  if (details.length > 4000) throw new Error("Keep the details under 4000 characters.");
  const page = typeof input.page === "string" && /^\/(?![/\\])/.test(input.page) ? input.page.slice(0, 500) : "/";
  const context = typeof input.context === "string" && input.context.trim() ? input.context.trim().slice(0, 500) : undefined;
  const contactEmail = typeof input.contactEmail === "string" ? input.contactEmail.trim() : "";
  if (contactEmail && (contactEmail.length > 320 || !EMAIL.test(contactEmail))) throw new Error("Enter a valid email address, or leave it empty.");
  return { app: app as ReportApp, kind: input.kind as DevFeedbackKind, message, ...(details ? { details } : {}), page, ...(context ? { context } : {}), ...(contactEmail ? { contactEmail } : {}) };
}

const ISSUES_URL = "https://github.com/MaximilianMauroner/microservices/issues/new";

/** A prefilled GitHub new-issue link, so the admin creates the issue in their own signed-in browser and no token is stored. */
export function githubIssueUrl(report: DevFeedback, reportsUrl: string) {
  const firstLine = report.message.split("\n")[0]!.trim();
  const title = `[${REPORT_APPS[report.app]}] ${firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine}`;
  const body = [
    report.message,
    ...(report.details ? ["", `### ${report.kind === "bug" ? "How to make it happen again" : "Why it would help"}`, "", report.details] : []),
    "",
    "---",
    `- App: ${REPORT_APPS[report.app]}`,
    `- Kind: ${report.kind === "bug" ? "Bug report" : "Idea"}`,
    `- ${report.app === "tools" ? "Page" : "Screen"}: \`${report.page}\``,
    ...(report.context ? [`- Context: ${report.context}`] : []),
    `- Sent: ${report.createdAt}`,
    `- Report: ${reportsUrl}#${report.id}`
  ].join("\n");
  const params = new URLSearchParams({ title, body, labels: report.kind === "bug" ? "bug" : "enhancement" });
  return `${ISSUES_URL}?${params}`;
}

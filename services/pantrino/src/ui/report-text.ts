import type { Report, ReportOutcome, ReportRejection } from "../sync/api";
import type { KitchenLanguage } from "./language";

export const REPORT_LIMIT = 4000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const en = {
  title: "Report a problem or idea",
  description: "The developer reads every report. The app version and system version are sent with it.",
  anonymous: "Send anonymously, without your name and email",
  bug: "Problem",
  feature: "Idea",
  bugPrompt: "What went wrong? What did you expect?",
  featurePrompt: "What should Pantrino do that it does not do now?",
  bugDetails: "How can the developer make it happen again? (optional)",
  featureDetails: "Why would it help you? (optional)",
  email: "Your email for a reply (optional)",
  send: "Send",
  sending: "Sending…",
  sent: "Thanks. Your report was sent.",
  offline: "You are offline. Connect to the internet and send it again.",
  failed: "The report could not be sent. Try again.",
  timeout: "Tools did not answer. Try again in a moment.",
  authFailed: "Your sign-in has expired. Sign in again, or send it anonymously.",
  rateLimited: "You sent many reports in a short time. Wait 10 minutes and send it again.",
  rejections: {
    unknown_app: "This version of Pantrino cannot send reports. Update the app.",
    invalid_kind: "Choose Problem or Idea.",
    empty_message: "Write what happened or what you would like.",
    message_too_long: "Make the message shorter.",
    details_too_long: "Make the details shorter.",
    invalid_email: "Enter a valid email address, or leave it empty.",
    unknown: "Tools did not accept the report. Check the text and try again."
  } as Record<ReportRejection | "unknown", string>
};
export const TEXT: Record<KitchenLanguage, typeof en> = {
  en,
  de: {
    title: "Problem oder Idee melden",
    description: "Der Entwickler liest jede Meldung. Die App-Version und die Systemversion werden mitgesendet.",
    anonymous: "Anonym senden, ohne deinen Namen und deine E-Mail",
    bug: "Problem",
    feature: "Idee",
    bugPrompt: "Was ist schiefgegangen? Was hast du erwartet?",
    featurePrompt: "Was soll Pantrino können, das es jetzt nicht kann?",
    bugDetails: "Wie kann der Entwickler es nachstellen? (optional)",
    featureDetails: "Warum würde es dir helfen? (optional)",
    email: "Deine E-Mail für eine Antwort (optional)",
    send: "Senden",
    sending: "Wird gesendet…",
    sent: "Danke. Deine Meldung wurde gesendet.",
    offline: "Du bist offline. Verbinde dich mit dem Internet und sende sie noch einmal.",
    failed: "Die Meldung konnte nicht gesendet werden. Versuche es erneut.",
    timeout: "Tools hat nicht geantwortet. Versuche es gleich noch einmal.",
    authFailed: "Deine Anmeldung ist abgelaufen. Melde dich erneut an oder sende die Meldung anonym.",
    rateLimited: "Du hast in kurzer Zeit viele Meldungen gesendet. Warte 10 Minuten und sende sie dann noch einmal.",
    rejections: {
      unknown_app: "Diese Pantrino-Version kann keine Meldungen senden. Aktualisiere die App.",
      invalid_kind: "Wähle Problem oder Idee.",
      empty_message: "Schreib, was passiert ist oder was du dir wünschst.",
      message_too_long: "Kürze die Nachricht.",
      details_too_long: "Kürze die Details.",
      invalid_email: "Gib eine gültige E-Mail-Adresse ein oder lass das Feld leer.",
      unknown: "Tools hat die Meldung nicht angenommen. Prüfe den Text und versuche es erneut."
    }
  }
};


/** The same checks as Tools, so the person sees a translated reason before anything is sent. */
export function checkReport(report: Report): ReportRejection | null {
  if (!report.message.trim()) return "empty_message";
  if (report.message.length > REPORT_LIMIT) return "message_too_long";
  if ((report.details?.length ?? 0) > REPORT_LIMIT) return "details_too_long";
  if (report.contactEmail && (report.contactEmail.length > 320 || !EMAIL.test(report.contactEmail))) return "invalid_email";
  return null;
}

export function outcomeMessage(outcome: Exclude<ReportOutcome, { kind: "sent" }>, text: (typeof TEXT)[KitchenLanguage]): string {
  switch (outcome.kind) {
    case "offline": return text.offline;
    case "timeout": return text.timeout;
    case "auth-failed": return text.authFailed;
    case "rate-limited": return text.rateLimited;
    case "rejected": return text.rejections[outcome.reason];
    case "failed": return text.failed;
  }
}

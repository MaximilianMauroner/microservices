import type { FeedbackForm, FeedbackSubmission } from "./domain.js";

export function feedbackCsv(form: FeedbackForm, submissions: readonly FeedbackSubmission[]) {
  const headers = ["submitted_at", "review_state", "follow_up_state", ...form.questions.map((question) => question.prompt)];
  const rows = submissions.map((submission) => [submission.submittedAt, submission.reviewState, submission.followUpState, ...form.questions.map((question) => submission.answers[question.id] ?? "")]);
  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function csvCell(value: string) {
  const protectedValue = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

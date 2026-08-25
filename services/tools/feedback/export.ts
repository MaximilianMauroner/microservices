import { feedbackChoiceDetailsKey, type FeedbackForm, type FeedbackSubmission } from "./domain.js";

export function feedbackCsv(form: FeedbackForm, submissions: readonly FeedbackSubmission[]) {
  const answerColumns = form.questions.flatMap((question) => question.kind === "choice"
    ? [{ header: question.prompt, key: question.id }, { header: `${question.prompt} - additional context`, key: feedbackChoiceDetailsKey(question.id) }]
    : [{ header: question.prompt, key: question.id }]);
  const headers = ["submitted_at", "review_state", "follow_up_state", ...answerColumns.map(({ header }) => header)];
  const rows = submissions.map((submission) => [submission.submittedAt, submission.reviewState, submission.followUpState, ...answerColumns.map(({ key }) => submission.answers[key] ?? "")]);
  return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function csvCell(value: string) {
  const protectedValue = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

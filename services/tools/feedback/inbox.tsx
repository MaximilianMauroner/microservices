"use client";

import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { ArchiveIcon, ArchiveRestoreIcon, CheckIcon, ChevronLeftIcon, FlagIcon, MailIcon, MoreHorizontalIcon, Trash2Icon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { AppShell } from "../src/components/app-shell.js";
import { PageHeader } from "../src/components/page-header.js";
import { Segmented } from "../src/components/segmented.js";
import { Badge } from "../src/components/ui/badge.js";
import { Button } from "../src/components/ui/button.js";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../src/components/ui/dropdown-menu.js";
import { NativeSelect, NativeSelectOption } from "../src/components/ui/native-select.js";
import { favicons } from "../src/favicons.js";
import { countLabel } from "../src/lib/count-label.js";
import { formatDateTime } from "../src/lib/format-date.js";
import { cn } from "../src/lib/utils.js";
import {
  FEEDBACK_INBOX_FILTERS,
  FEEDBACK_INBOX_LIMIT,
  feedbackChoiceDetailsKey,
  matchesFeedbackInboxFilter,
  type FeedbackFollowUpState,
  type FeedbackInboxFilter,
  type FeedbackQuestion,
  type FeedbackReviewState,
  type FeedbackSubmission
} from "./domain.js";
import { deleteFeedbackSubmission, updateFeedbackSubmission } from "./server-functions.js";
import { ConfirmDialog, CountBadge, feedbackErrorMessage, formatInboxTime } from "./ui.js";

/** Inbox state in the URL, so links and reloads open the same view. Unread is the default filter. */
export type FeedbackInboxSearch = { response?: string; filter?: Exclude<FeedbackInboxFilter, "unread">; form?: string };

export function parseFeedbackInboxSearch(search: Record<string, unknown>): FeedbackInboxSearch {
  const filter = FEEDBACK_INBOX_FILTERS.find((item) => item === search.filter);
  return {
    response: typeof search.response === "string" && search.response ? search.response : undefined,
    filter: filter === "unread" ? undefined : filter,
    form: typeof search.form === "string" && search.form ? search.form : undefined
  };
}

const EMPTY_COPY: Record<FeedbackInboxFilter, string> = {
  unread: "No unread responses.",
  "follow-up": "No responses need a follow-up.",
  all: "No responses yet.",
  archived: "No archived responses."
};

export function FeedbackInbox({ forms, submissions: loaded, search }: { forms: readonly { id: string; title: string }[]; submissions: readonly FeedbackSubmission[]; search: FeedbackInboxSearch }) {
  const navigate = useNavigate();
  // Local results of review actions, so the list updates without reading every response again. Undefined means deleted.
  const [changes, setChanges] = useState<ReadonlyMap<string, FeedbackSubmission | undefined>>(new Map());
  const [base, setBase] = useState(loaded);
  if (base !== loaded) { setBase(loaded); setChanges(new Map()); }
  const submissions = loaded.flatMap((submission) => {
    const changed = changes.has(submission.id) ? changes.get(submission.id) : submission;
    return changed ? [changed] : [];
  });

  const filter = search.filter ?? "unread";
  const inForm = search.form ? submissions.filter((submission) => submission.formId === search.form) : submissions;
  const visible = inForm.filter((submission) => matchesFeedbackInboxFilter(submission, filter));
  const unread = submissions.filter((submission) => submission.reviewState === "unread");
  const unreadForms = new Set(unread.map((submission) => submission.formId)).size;
  // On a wide screen the first response opens by default. On a narrow screen only an explicit selection opens the reader.
  const selected = search.response ? submissions.find((submission) => submission.id === search.response) : visible[0];
  const reading = search.response !== undefined;

  function changeSearch(next: Partial<FeedbackInboxSearch>) { void navigate({ to: "/feedback", search: { ...search, response: undefined, ...next } }); }
  function changed(id: string, submission: FeedbackSubmission | undefined) {
    setChanges((current) => new Map(current).set(id, submission));
    if (!submission && search.response === id) changeSearch({});
  }

  const filterOptions: readonly (readonly [FeedbackInboxFilter, ReactNode])[] = [
    ["unread", <>Unread <CountBadge count={inForm.filter((submission) => matchesFeedbackInboxFilter(submission, "unread")).length} className="h-[18px] min-w-[18px]" /></>],
    ["follow-up", <>Follow-up <CountBadge tone="muted" count={inForm.filter((submission) => matchesFeedbackInboxFilter(submission, "follow-up")).length} className="h-[18px] min-w-[18px]" /></>],
    ["all", "All"],
    ["archived", "Archived"]
  ];

  return <>
    <AppShell product="Feedback" icon={favicons.feedback} accent="rose" />
    <main id="main" className="tools-page">
      <div className={cn(reading && "max-lg:hidden")}>
        <PageHeader
          title="Responses"
          facts={unread.length ? `${unread.length.toLocaleString("en-GB")} unread in ${countLabel(unreadForms, "form")}` : "Nothing unread"}
          actions={<NativeSelect className="w-44" aria-label="Form" value={search.form ?? ""} onChange={(event) => changeSearch({ form: event.target.value || undefined })}>
            <NativeSelectOption value="">All forms</NativeSelectOption>
            {forms.map((form) => <NativeSelectOption key={form.id} value={form.id}>{form.title || "Untitled form"}</NativeSelectOption>)}
          </NativeSelect>}
        />
        <div className="mb-3">
          <Segmented label="Show responses" options={filterOptions} value={filter} onValue={(value) => changeSearch({ filter: value === "unread" ? undefined : value })} />
        </div>
      </div>
      <section className="overflow-hidden rounded-xl border bg-card lg:grid lg:h-[max(560px,calc(100dvh-10.5rem))] lg:grid-cols-[300px_minmax(0,1fr)]" aria-label="Responses">
        <div className={cn("flex min-w-0 flex-col lg:overflow-y-auto lg:border-r", reading && "max-lg:hidden")}>
          {visible.length ? visible.map((submission) => <ResponseListItem key={submission.id} submission={submission} search={search} current={submission.id === search.response} selected={submission.id === selected?.id} />) : <p className="px-4 py-10 text-center text-sm text-muted-foreground">{EMPTY_COPY[filter]}</p>}
          {loaded.length >= FEEDBACK_INBOX_LIMIT ? <p className="px-4 py-3 text-xs text-muted-foreground">Shows the newest {FEEDBACK_INBOX_LIMIT} responses. Export a form as CSV to see all of its responses.</p> : null}
        </div>
        <div className={cn("min-w-0 lg:overflow-y-auto", !reading && "max-lg:hidden")}>
          {selected
            ? <ResponseReader key={selected.id} submission={selected} onChanged={(submission) => changed(selected.id, submission)} backLink={<Link to="/feedback" search={{ ...search, response: undefined }} className="inline-flex basis-full items-center gap-1 text-[0.8125rem] text-muted-foreground hover:text-foreground lg:hidden"><ChevronLeftIcon className="size-4" />Responses</Link>} />
            : <div className="grid h-full min-h-60 place-items-center p-6 text-center text-sm text-muted-foreground">
              <div>
                <MailIcon className="mx-auto mb-2 size-5" aria-hidden="true" />
                {search.response ? <>This response is not in the list. <Link className="text-foreground underline underline-offset-4" to="/feedback/responses/$submissionId" params={{ submissionId: search.response }}>Open it on its own page</Link>.</> : "Select a response to read it."}
              </div>
            </div>}
        </div>
      </section>
    </main>
  </>;
}

/** A direct link to one response. It uses the same reader as the inbox. */
export function FeedbackResponsePage({ submission }: { submission: FeedbackSubmission }) {
  const router = useRouter();
  const navigate = useNavigate();
  return <>
    <AppShell product="Feedback" icon={favicons.feedback} accent="rose" />
    <main id="main" className="tools-page">
      <PageHeader parent={{ label: "Responses", to: "/feedback" }} title="Response" />
      <section className="overflow-hidden rounded-xl border bg-card">
        <ResponseReader submission={submission} onChanged={async (updated) => { if (updated) await router.invalidate(); else await navigate({ to: "/feedback" }); }} />
      </section>
    </main>
  </>;
}

function ResponseListItem({ submission, search, current, selected }: { submission: FeedbackSubmission; search: FeedbackInboxSearch; current: boolean; selected: boolean }) {
  const unread = submission.reviewState === "unread";
  return (
    <Link
      to="/feedback"
      search={{ ...search, response: submission.id }}
      aria-current={current ? "true" : undefined}
      data-selected={selected || undefined}
      className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-baseline gap-x-2.5 gap-y-1 border-b border-border/60 px-3.5 py-2.5 text-left outline-none hover:bg-muted/70 focus-visible:bg-muted/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 lg:data-selected:bg-secondary/55 lg:data-selected:shadow-[inset_3px_0_var(--primary)]"
    >
      <span className={cn("size-[7px] self-center rounded-full", unread && "bg-primary")} aria-hidden="true" />
      <span className={cn("flex min-w-0 items-center gap-1.5 text-sm", unread ? "font-semibold" : "font-medium")}>
        {unread ? <span className="sr-only">Unread: </span> : null}
        <span className="truncate">{respondentName(submission)}</span>
        {submission.followUpState === "wanted" ? <FlagIcon className="size-3.5 shrink-0" role="img" aria-label="Follow-up wanted" /> : null}
      </span>
      <time className="text-xs whitespace-nowrap text-muted-foreground" dateTime={submission.submittedAt} suppressHydrationWarning>{formatInboxTime(submission.submittedAt)}</time>
      <span className="col-span-2 col-start-2 truncate text-[0.8125rem] text-muted-foreground">{responseSummary(submission)}</span>
    </Link>
  );
}

/** Next follow-up step for each state: ask for one, finish it, or clear it. */
const FOLLOW_UP_ACTION: Record<FeedbackFollowUpState, { label: string; next: FeedbackFollowUpState }> = {
  none: { label: "Follow up", next: "wanted" },
  wanted: { label: "Mark follow-up done", next: "done" },
  done: { label: "Clear follow-up", next: "none" }
};

/** One response with its review actions. Reports the updated response, or undefined after deletion. */
export function ResponseReader({ submission, backLink, onChanged }: { submission: FeedbackSubmission; backLink?: ReactNode; onChanged: (submission: FeedbackSubmission | undefined) => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const followUp = FOLLOW_UP_ACTION[submission.followUpState];

  async function update(change: { reviewState?: FeedbackReviewState; followUpState?: FeedbackFollowUpState }) {
    setBusy(true); setError(undefined);
    try {
      const updated = await updateFeedbackSubmission({ data: { submissionId: submission.id, reviewState: change.reviewState ?? submission.reviewState, followUpState: change.followUpState ?? submission.followUpState } });
      if (!updated) throw new Error("This response no longer exists.");
      await onChanged(updated);
    } catch (caught) { setError(feedbackErrorMessage(caught)); } finally { setBusy(false); }
  }
  async function remove() {
    await deleteFeedbackSubmission({ data: { submissionId: submission.id } });
    await onChanged(undefined);
  }

  return (
    <article className="flex min-w-0 flex-col" aria-labelledby={`response-${submission.id}`}>
      <header className="flex flex-wrap items-start justify-between gap-2.5 border-b px-4 py-3.5 sm:px-5">
        {backLink}
        <div className="min-w-0 flex-[1_1_200px]">
          <h2 id={`response-${submission.id}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-semibold">
            <span className="min-w-0 wrap-anywhere">{respondentName(submission)}</span>
            <ReviewBadge state={submission.reviewState} />
          </h2>
          <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">{submission.formTitle || "Untitled form"} · {formatDateTime(submission.submittedAt)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {submission.reviewState === "unread"
            ? <Button size="sm" disabled={busy} onClick={() => void update({ reviewState: "reviewed" })}><CheckIcon data-icon="inline-start" />Mark reviewed</Button>
            : submission.reviewState === "reviewed"
              ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void update({ reviewState: "unread" })}>Mark unread</Button>
              : <Button size="sm" variant="outline" disabled={busy} onClick={() => void update({ reviewState: "reviewed" })}><ArchiveRestoreIcon data-icon="inline-start" />Restore</Button>}
          <Button size="sm" variant="outline" disabled={busy} title={followUp.label} onClick={() => void update({ followUpState: followUp.next })}><FlagIcon data-icon="inline-start" /><span className="max-sm:sr-only">{followUp.label}</span></Button>
          {submission.reviewState !== "archived" ? <Button size="icon-sm" variant="outline" disabled={busy} aria-label="Archive" title="Archive" onClick={() => void update({ reviewState: "archived" })}><ArchiveIcon /></Button> : null}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label="More actions" disabled={busy} />}><MoreHorizontalIcon /></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}><Trash2Icon />Delete permanently</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {error ? <p className="basis-full text-sm text-destructive" role="alert">{error}</p> : null}
      </header>
      <div className="grid max-w-[72ch] gap-3.5 px-4 py-3.5 sm:px-5">
        {submission.questionSnapshot.map((question) => <Answer key={question.id} question={question} answers={submission.answers} />)}
      </div>
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title="Delete this response?" description="This deletes the response permanently. You cannot undo it." action="Delete permanently" destructive onConfirm={remove} />
    </article>
  );
}

function Answer({ question, answers }: { question: FeedbackQuestion; answers: FeedbackSubmission["answers"] }) {
  const answer = answers[question.id];
  const details = question.kind === "choice" ? answers[feedbackChoiceDetailsKey(question.id)] : undefined;
  return (
    <div>
      <p className="mb-1 text-[0.8125rem] text-muted-foreground">{question.prompt}</p>
      {answer
        ? question.kind === "choice"
          ? <p><span className="inline-flex min-h-6 items-center rounded-full bg-secondary px-2.5 py-0.5 text-[0.8125rem] font-medium text-secondary-foreground">{answerLabel(question, answer)}</span></p>
          : <p className="text-sm whitespace-pre-wrap wrap-anywhere">{answer}</p>
        : details ? null : <p className="text-sm text-muted-foreground italic">No answer</p>}
      {details ? <p className="mt-1.5 border-l pl-2.5 text-[0.8125rem] whitespace-pre-wrap text-muted-foreground wrap-anywhere">{details}</p> : null}
    </div>
  );
}

function ReviewBadge({ state }: { state: FeedbackReviewState }) {
  return state === "unread" ? <Badge variant="secondary">Unread</Badge> : <Badge variant="outline">{state === "reviewed" ? "Reviewed" : "Archived"}</Badge>;
}

function respondentName(submission: FeedbackSubmission) { return submission.answers.identity || "Anonymous"; }

/** Older snapshots stored option keys with separate labels. */
function answerLabel(question: FeedbackQuestion, answer: string) {
  const index = question.options?.indexOf(answer) ?? -1;
  return index >= 0 ? question.optionLabels?.[index] ?? answer : answer;
}

/** "Form title · first choice answer · first written text". */
function responseSummary(submission: FeedbackSubmission) {
  const questions = submission.questionSnapshot;
  const choice = questions.find((question) => question.kind === "choice" && submission.answers[question.id]);
  const text = questions.flatMap((question) => question.kind === "choice" ? [submission.answers[feedbackChoiceDetailsKey(question.id)]] : question.id === "identity" ? [] : [submission.answers[question.id]]).find(Boolean);
  return [submission.formTitle || "Untitled form", choice ? answerLabel(choice, submission.answers[choice.id]!) : undefined, text].filter(Boolean).join(" · ");
}

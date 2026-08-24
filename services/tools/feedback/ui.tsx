"use client";

import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { AppShell } from "../src/components/app-shell.js";
import { favicons } from "../src/favicons.js";
import { DEFAULT_GERMAN_TRANSLATION, FEEDBACK_TEMPLATE, type FeedbackForm, type FeedbackFollowUpState, type FeedbackQuestion, type FeedbackReviewState, type FeedbackSubmission, type FeedbackTranslation } from "./domain.js";
import {
  createFeedbackForm,
  deleteFeedbackForm,
  deleteFeedbackSubmission,
  rotateFeedbackToken,
  setFeedbackFormStatus,
  updateFeedbackForm,
  updateFeedbackSubmission
} from "./server-functions.js";

const button = "inline-flex min-h-10 items-center justify-center rounded-md border px-3 py-2 text-sm font-semibold hover:bg-accent disabled:opacity-50";
const input = "w-full rounded-md border bg-background px-3 py-2 text-sm";

export function FeedbackHome({ forms }: { forms: readonly FeedbackForm[] }) {
  const router = useRouter();
  const navigate = useNavigate();
  const [title, setTitle] = useState("Post-hangout feedback");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(undefined);
    try {
      const form = await createFeedbackForm({ data: { title } });
      await navigate({ to: "/feedback/forms/$formId", params: { formId: form.id } });
    } catch (caught) { setError(message(caught)); } finally { setBusy(false); }
  }
  return <>
    <AppShell product="Feedback" icon={favicons.feedback} showSignOut accent="rose" />
    <main id="main" className="mx-auto w-[min(1000px,calc(100%_-_2rem))] pb-20 pt-10">
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <section>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">Private inbox</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Feedback forms</h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">Share an unlisted link. Read every response here after signing in.</p>
          <div className="mt-8 grid gap-3">
            {forms.length ? forms.map((form) => <Link key={form.id} to="/feedback/forms/$formId" params={{ formId: form.id }} preload="intent" className="rounded-xl border bg-card p-5 hover:bg-accent">
              <div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold">{form.title}</h2><p className="mt-1 text-sm text-muted-foreground">{form.responseCount} responses, {form.unreadCount} unread</p></div><span className="rounded-full border px-2 py-1 text-xs capitalize">{form.status}</span></div>
            </Link>) : <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">No forms yet. Create the first one.</p>}
          </div>
        </section>
        <aside className="rounded-xl border bg-card p-5 lg:self-start">
          <h2 className="font-semibold">Create a form</h2><p className="mt-1 text-sm text-muted-foreground">Starts with the post-hangout question set.</p>
          <form className="mt-4 grid gap-3" onSubmit={create}><label className="grid gap-1 text-sm font-medium">Title<input className={input} maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} required /></label>{error ? <p className="text-sm text-destructive">{error}</p> : null}<button className={`${button} bg-primary text-primary-foreground`} disabled={busy}>{busy ? "Creating..." : "Create form"}</button></form>
        </aside>
      </div>
    </main>
  </>;
}

export function FeedbackFormPage({ form, submissions, publicOrigin }: { form: FeedbackForm; submissions: readonly FeedbackSubmission[]; publicOrigin: string }) {
  const router = useRouter(); const navigate = useNavigate();
  const [title, setTitle] = useState(form.title); const [introduction, setIntroduction] = useState(form.introduction); const [busy, setBusy] = useState(false); const [error, setError] = useState<string>();
  const [questions, setQuestions] = useState<readonly FeedbackQuestion[]>(form.questions);
  const [german, setGerman] = useState<FeedbackTranslation>(form.translations.de ?? DEFAULT_GERMAN_TRANSLATION);
  const publicUrl = `${publicOrigin}/feedback/f/${form.publicToken}`;
  async function run(action: () => Promise<unknown>) { setBusy(true); setError(undefined); try { await action(); await router.invalidate(); } catch (caught) { setError(message(caught)); } finally { setBusy(false); } }
  async function save(event: FormEvent) { event.preventDefault(); await run(() => updateFeedbackForm({ data: { formId: form.id, title, introduction, questions, german } })); }
  function setIdentityQuestion(enabled: boolean) {
    const identity = FEEDBACK_TEMPLATE.find((question) => question.id === "identity")!;
    setQuestions((current) => enabled ? current.some((question) => question.id === "identity") ? current : [...current, identity] : current.filter((question) => question.id !== "identity"));
  }
  async function remove() { if (!window.confirm(`Delete ${form.title} and all ${form.responseCount} responses permanently?`)) return; await run(async () => { await deleteFeedbackForm({ data: { formId: form.id } }); await navigate({ to: "/feedback" }); }); }
  return <>
    <AppShell product="Feedback" icon={favicons.feedback} showSignOut accent="rose" />
    <main id="main" className="mx-auto w-[min(1080px,calc(100%_-_2rem))] pb-20 pt-8">
      <Link to="/feedback" className="text-sm text-muted-foreground hover:text-foreground">Back to forms</Link>
      <div className="mt-5 grid gap-8 lg:grid-cols-[1fr_23rem]">
        <section><div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-3xl font-semibold">{form.title}</h1><p className="mt-2 text-sm text-muted-foreground">{form.responseCount} responses, {form.unreadCount} unread</p></div><span className="rounded-full border px-3 py-1 text-sm capitalize">{form.status}</span></div>
          <h2 className="mt-8 text-lg font-semibold">Responses</h2><div className="mt-3 grid gap-2">{submissions.length ? submissions.map((submission) => <Link key={submission.id} to="/feedback/responses/$submissionId" params={{ submissionId: submission.id }} className="rounded-lg border bg-card p-4 hover:bg-accent"><div className="flex justify-between gap-4"><span className="font-medium">{submission.answers.identity || "Anonymous response"}</span><time className="text-xs text-muted-foreground">{new Date(submission.submittedAt).toLocaleString()}</time></div><p className="mt-1 text-sm text-muted-foreground">{submission.answers.comfort || "No comfort rating"} · {submission.reviewState}</p></Link>) : <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">No responses yet.</p>}</div>
        </section>
        <aside className="grid gap-4 self-start">
          <section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">Public link</h2><p className="mt-1 break-all text-xs text-muted-foreground">{publicUrl}</p><div className="mt-3 grid grid-cols-2 gap-2"><button className={button} type="button" onClick={() => navigator.clipboard.writeText(publicUrl)}>Copy link</button><a className={button} href={publicUrl} target="_blank" rel="noreferrer">Preview</a></div><div className="mt-2 grid grid-cols-2 gap-2"><button className={button} disabled={busy} onClick={() => run(() => setFeedbackFormStatus({ data: { formId: form.id, status: form.status === "active" ? "closed" : "active" } }))}>{form.status === "active" ? "Close" : "Activate"}</button><button className={button} disabled={busy} onClick={() => window.confirm("Rotate this link? The current link will stop working.") && run(() => rotateFeedbackToken({ data: { formId: form.id } }))}>Rotate link</button></div><a className={`${button} mt-2 w-full`} href={`/api/feedback/forms/${form.id}/export`}>Export CSV</a></section>
          <form className="rounded-xl border bg-card p-5" onSubmit={save}><h2 className="font-semibold">Form text</h2><label className="mt-4 grid gap-1 text-sm font-medium">English title<input className={input} maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label className="mt-3 grid gap-1 text-sm font-medium">English introduction<textarea className={`${input} min-h-36`} maxLength={2000} value={introduction} onChange={(event) => setIntroduction(event.target.value)} /></label><label className="mt-4 flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={questions.some((question) => question.id === "identity")} onChange={(event) => setIdentityQuestion(event.target.checked)} />Include "Your name or contact details"</label><div className="mt-4 grid gap-3"><h3 className="text-sm font-semibold">English questions</h3>{questions.map((question, index) => <label className="grid gap-1 text-xs font-medium text-muted-foreground" key={question.id}>Question {index + 1}<textarea className={`${input} min-h-20 text-foreground`} maxLength={300} value={question.prompt} onChange={(event) => setQuestions((current) => current.map((item) => item.id === question.id ? { ...item, prompt: event.target.value } : item))} /></label>)}</div><div className="mt-6 border-t pt-5"><h3 className="font-semibold">German translation</h3><label className="mt-3 grid gap-1 text-sm font-medium">German title<input className={input} maxLength={120} value={german.title} onChange={(event) => setGerman((current) => ({ ...current, title: event.target.value }))} /></label><label className="mt-3 grid gap-1 text-sm font-medium">German introduction<textarea className={`${input} min-h-36`} maxLength={2000} value={german.introduction} onChange={(event) => setGerman((current) => ({ ...current, introduction: event.target.value }))} /></label><div className="mt-4 grid gap-3">{questions.map((question, index) => <div className="grid gap-2" key={question.id}><label className="grid gap-1 text-xs font-medium text-muted-foreground">German question {index + 1}<textarea className={`${input} min-h-20 text-foreground`} maxLength={300} value={german.questionPrompts[question.id] ?? question.prompt} onChange={(event) => setGerman((current) => ({ ...current, questionPrompts: { ...current.questionPrompts, [question.id]: event.target.value } }))} /></label>{question.kind === "choice" ? <div className="grid gap-2 pl-3">{question.options?.map((option, optionIndex) => <label className="grid gap-1 text-xs text-muted-foreground" key={option}>German choice {optionIndex + 1}<input className={`${input} text-foreground`} maxLength={120} value={german.optionLabels[question.id]?.[optionIndex] ?? option} onChange={(event) => setGerman((current) => { const labels = [...(current.optionLabels[question.id] ?? question.options ?? [])]; labels[optionIndex] = event.target.value; return { ...current, optionLabels: { ...current.optionLabels, [question.id]: labels } }; })} /></label>)}</div> : null}</div>)}</div></div>{error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}<button className={`${button} mt-4 w-full`} disabled={busy}>Save form</button></form>
          <section className="rounded-xl border border-destructive/40 p-5"><h2 className="font-semibold text-destructive">Delete form</h2><p className="mt-1 text-sm text-muted-foreground">This permanently deletes every response.</p><button className={`${button} mt-3 w-full text-destructive`} disabled={busy} onClick={remove}>Delete permanently</button></section>
        </aside>
      </div>
    </main>
  </>;
}

export function FeedbackResponsePage({ submission }: { submission: FeedbackSubmission }) {
  const router = useRouter(); const navigate = useNavigate(); const [busy, setBusy] = useState(false); const [error, setError] = useState<string>();
  async function update(reviewState: FeedbackReviewState, followUpState: FeedbackFollowUpState) { setBusy(true); setError(undefined); try { await updateFeedbackSubmission({ data: { submissionId: submission.id, reviewState, followUpState } }); await router.invalidate(); } catch (caught) { setError(message(caught)); } finally { setBusy(false); } }
  async function remove() { if (!window.confirm("Delete this response permanently?")) return; setBusy(true); try { await deleteFeedbackSubmission({ data: { submissionId: submission.id } }); await navigate({ to: "/feedback/forms/$formId", params: { formId: submission.formId } }); } catch (caught) { setError(message(caught)); setBusy(false); } }
  return <><AppShell product="Feedback" icon={favicons.feedback} showSignOut accent="rose" /><main id="main" className="mx-auto w-[min(780px,calc(100%_-_2rem))] pb-20 pt-8"><Link to="/feedback/forms/$formId" params={{ formId: submission.formId }} className="text-sm text-muted-foreground hover:text-foreground">Back to {submission.formTitle}</Link><div className="mt-5 flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-semibold">{submission.answers.identity || "Anonymous response"}</h1><time className="mt-2 block text-sm text-muted-foreground">{new Date(submission.submittedAt).toLocaleString()}</time></div><span className="rounded-full border px-3 py-1 text-sm capitalize">{submission.reviewState}</span></div><div className="mt-8 grid gap-5">{submission.questionSnapshot.map((question) => <section key={question.id} className="rounded-xl border bg-card p-5"><h2 className="text-sm font-semibold text-muted-foreground">{question.prompt}</h2><p className="mt-2 whitespace-pre-wrap">{displayAnswer(question, submission.answers[question.id]) || <span className="text-muted-foreground">No answer</span>}</p></section>)}</div>{error ? <p className="mt-5 text-sm text-destructive">{error}</p> : null}<div className="mt-6 flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => update("reviewed", submission.followUpState)}>Mark reviewed</button><button className={button} disabled={busy} onClick={() => update("archived", submission.followUpState)}>Archive</button><button className={button} disabled={busy} onClick={() => update(submission.reviewState, submission.followUpState === "done" ? "none" : "done")}>{submission.followUpState === "done" ? "Clear follow-up" : "Mark follow-up done"}</button><button className={`${button} text-destructive`} disabled={busy} onClick={remove}>Delete permanently</button></div></main></>;
}

function message(error: unknown) { return error instanceof Error ? error.message : "The feedback action failed."; }
function displayAnswer(question: FeedbackQuestion, answer: string | undefined) { if (!answer || question.kind !== "choice") return answer; const index = question.options?.indexOf(answer) ?? -1; return index >= 0 ? question.optionLabels?.[index] ?? answer : answer; }

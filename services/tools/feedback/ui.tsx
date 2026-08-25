"use client";

import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { AppShell } from "../src/components/app-shell.js";
import { favicons } from "../src/favicons.js";
import { type FeedbackForm, type FeedbackFollowUpState, type FeedbackLanguage, type FeedbackQuestion, type FeedbackReviewState, type FeedbackSubmission } from "./domain.js";
import {
  createFeedbackForm,
  deleteFeedbackForm,
  deleteFeedbackSubmission,
  rotateFeedbackToken,
  setFeedbackFormStatus,
  updateFeedbackForm,
  updateFeedbackSubmission
} from "./server-functions.js";
import { feedbackSchemaJson, feedbackSchemaPrompt, parseFeedbackSchemaJson } from "./schema-exchange.js";
import { copyFeedbackText } from "./clipboard.js";
import { FeedbackQuestionEditor } from "./question-editor.js";

const button = "inline-flex min-h-10 items-center justify-center rounded-lg border px-3 py-2 text-sm font-semibold transition-colors hover:bg-accent disabled:opacity-50";
const input = "w-full rounded-lg border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary/60";
const card = "rounded-2xl border bg-card/80 shadow-[0_20px_60px_rgba(0,0,0,0.22)]";

export function FeedbackHome({ forms }: { forms: readonly FeedbackForm[] }) {
  const router = useRouter();
  const navigate = useNavigate();
  const [language, setLanguage] = useState<FeedbackLanguage | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(undefined);
    try {
      if (!language) throw new Error("Choose German or English.");
      const form = await createFeedbackForm({ data: { language } });
      await navigate({ to: "/feedback/forms/$formId", params: { formId: form.id } });
    } catch (caught) { setError(message(caught)); } finally { setBusy(false); }
  }
  return <>
    <AppShell product="Feedback" icon={favicons.feedback} showSignOut accent="rose" />
    <main id="main" className="mx-auto w-[min(1120px,calc(100%_-_2rem))] pb-20 pt-10">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">Private inbox</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Feedback forms</h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">Create an unlisted feedback link and read responses after signing in.</p>
          <div className="mt-8 grid gap-3">
            {forms.length ? forms.map((form) => <Link key={form.id} to="/feedback/forms/$formId" params={{ formId: form.id }} preload="intent" className="group rounded-2xl border bg-gradient-to-b from-card to-background/60 p-5 transition-colors hover:border-primary/35 hover:bg-accent">
              <div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold group-hover:text-primary">{form.title || `Untitled ${form.language === "de" ? "German" : "English"} form`}</h2><p className="mt-1 text-sm text-muted-foreground"><span className="capitalize">{form.language === "de" ? "German" : "English"}</span> · {form.responseCount} responses · {form.unreadCount} unread</p></div><span className="rounded-full border px-2.5 py-1 text-xs capitalize text-muted-foreground">{form.status}</span></div>
            </Link>) : <div className="rounded-2xl border border-dashed p-8 text-center"><p className="font-medium">No forms yet</p><p className="mt-1 text-sm text-muted-foreground">Choose a language and create the first empty draft.</p></div>}
          </div>
        </section>
        <aside className={`${card} p-5 lg:self-start`}>
          <h2 className="font-semibold">Create an empty form</h2><p className="mt-1 text-sm text-muted-foreground">Choose its only language. You will add the content next.</p>
          <form className="mt-5 grid gap-4" onSubmit={create}>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Form language">
              {([['de', '🇩🇪', 'German'], ['en', '🇬🇧', 'English']] as const).map(([value, flag, label]) => <button key={value} className={`relative rounded-xl border px-3 py-4 text-center transition-colors ${language === value ? "border-primary bg-primary/10 text-primary" : "bg-background hover:bg-accent"}`} type="button" aria-pressed={language === value} onClick={() => setLanguage(value)}>{language === value ? <span className="absolute right-2 top-2 grid size-5 place-items-center rounded-full bg-primary text-xs font-black text-primary-foreground">✓</span> : null}<span className="block text-2xl" aria-hidden="true">{flag}</span><span className="mt-2 block text-sm font-semibold">{label}</span></button>)}
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}<button className={`${button} w-full bg-primary text-primary-foreground hover:bg-primary/90`} disabled={busy || !language}>{busy ? "Creating..." : "Create empty form"}</button>
          </form>
          <p className="mt-3 text-xs text-muted-foreground">No default title, introduction, or questions.</p>
        </aside>
      </div>
    </main>
  </>;
}

export function FeedbackFormPage({ form, submissions, publicOrigin }: { form: FeedbackForm; submissions: readonly FeedbackSubmission[]; publicOrigin: string }) {
  const router = useRouter(); const navigate = useNavigate();
  const [language, setLanguage] = useState<FeedbackLanguage>(form.language); const [title, setTitle] = useState(form.title); const [introduction, setIntroduction] = useState(form.introduction); const [busy, setBusy] = useState(false); const [error, setError] = useState<string>();
  const [questions, setQuestions] = useState<readonly FeedbackQuestion[]>(form.questions);
  const [schemaText, setSchemaText] = useState("");
  const [schemaNotice, setSchemaNotice] = useState<string>();
  const [mobileEditorOpen, setMobileEditorOpen] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const publicUrl = `${publicOrigin}/feedback/f/${form.publicToken}`;
  async function run(action: () => Promise<unknown>) { setBusy(true); setError(undefined); try { await action(); await router.invalidate(); } catch (caught) { setError(message(caught)); } finally { setBusy(false); } }
  async function save(event: FormEvent) { event.preventDefault(); await run(() => updateFeedbackForm({ data: { formId: form.id, language, title, introduction, questions } })); }
  function setIdentityQuestion(enabled: boolean) {
    const identity = identityQuestion(language);
    setQuestions((current) => enabled ? current.some((question) => question.id === "identity") ? current.map((question) => question.id === "identity" ? identity : question) : [...current, identity] : current.filter((question) => question.id !== "identity"));
  }
  const editableContent = { language, title, introduction, questions };
  async function copySchema(kind: "json" | "prompt") {
    const text = kind === "json" ? feedbackSchemaJson(editableContent) : feedbackSchemaPrompt(editableContent);
    setSchemaText(text);
    const copied = await copyFeedbackText(text, kind === "json" ? "JSON copied" : "Prompt copied");
    setSchemaNotice(copied ? (kind === "json" ? "Schema copied." : "Prompt copied.") : "Clipboard access failed. Copy the text from the box instead.");
  }
  function applySchema() {
    try {
      const parsed = parseFeedbackSchemaJson(schemaText);
      setLanguage(parsed.language); setTitle(parsed.title); setIntroduction(parsed.introduction); setQuestions(parsed.questions);
      setSchemaNotice("Schema applied to the editor. Save the form to store it."); setError(undefined);
    } catch (caught) { setSchemaNotice(message(caught)); }
  }
  async function remove() { if (!window.confirm(`Delete ${form.title} and all ${form.responseCount} responses permanently?`)) return; await run(async () => { await deleteFeedbackForm({ data: { formId: form.id } }); await navigate({ to: "/feedback" }); }); }
  return <>
    <AppShell product="Feedback" icon={favicons.feedback} showSignOut accent="rose" />
    <main id="main" className="mx-auto w-[min(1120px,calc(100%_-_2rem))] pb-20 pt-8">
      <Link to="/feedback" className="text-sm text-muted-foreground hover:text-foreground">Back to forms</Link>
      <div className="mt-5 flex flex-wrap items-start justify-between gap-4"><div><p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">{language === "de" ? "German" : "English"} {form.status === "draft" ? "draft" : "form"}</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">{form.title || "Untitled form"}</h1><p className="mt-2 text-sm text-muted-foreground">{form.responseCount} responses · {form.unreadCount} unread</p></div><span className="rounded-full border px-3 py-1 text-sm capitalize text-muted-foreground">{form.status}</span></div>
      <section className="mt-5 lg:hidden" aria-label="Feedback overview">
        <div className="grid grid-cols-[1.2fr_1fr] gap-2"><a className={`${button} bg-primary text-primary-foreground hover:bg-primary/90`} href={publicUrl} target="_blank" rel="noreferrer">View public form</a><button className={button} type="button" onClick={() => void copyFeedbackText(publicUrl, "Link copied")}>Copy link</button></div>
        <div className="mt-3 grid grid-cols-2 gap-2"><div className={`${card} p-4`}><strong className="block text-2xl">{form.responseCount}</strong><span className="text-xs text-muted-foreground">Total responses</span></div><div className={`${card} p-4`}><strong className="block text-2xl">{form.unreadCount}</strong><span className="text-xs text-muted-foreground">Unread answers</span></div></div>
        <div className="mt-5 flex items-center justify-between"><h2 className="font-semibold">Recent responses</h2><span className="text-xs text-muted-foreground">Newest first</span></div>
        <div className="mt-2 grid gap-2">{submissions.length ? submissions.slice(0, 3).map((submission) => <SubmissionLink key={submission.id} submission={submission} />) : <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">No responses yet.</p>}</div>
        {submissions.length > 3 ? <details className="mt-2 rounded-xl border bg-card/50"><summary className="cursor-pointer px-4 py-3 text-center text-sm font-semibold">View all {submissions.length} responses</summary><div className="grid gap-2 border-t p-2">{submissions.slice(3).map((submission) => <SubmissionLink key={submission.id} submission={submission} />)}</div></details> : null}
      </section>
      <div className="mt-7 grid gap-5 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="grid gap-6 self-start">
          <button className="rounded-2xl border bg-card/80 p-5 text-left font-semibold lg:hidden" type="button" aria-expanded={mobileEditorOpen} aria-controls="feedback-form-editor" onClick={() => setMobileEditorOpen((open) => !open)}>Edit form <span className="mt-1 block text-xs font-normal text-muted-foreground">Title, introduction, and questions</span></button>
          <form id="feedback-form-editor" className={`${card} ${mobileEditorOpen ? "block" : "hidden"} p-5 sm:p-6 lg:block`} onSubmit={save}>
            <h2 className="font-semibold">Form text</h2><p className="mt-1 text-sm text-muted-foreground">This content is shown in one language only.</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-medium">Language<select className={input} value={language} onChange={(event) => setLanguage(event.target.value as FeedbackLanguage)}><option value="de">German</option><option value="en">English</option></select></label><label className="grid gap-1.5 text-sm font-medium">Title<input className={input} maxLength={120} placeholder="Enter a title" value={title} onChange={(event) => setTitle(event.target.value)} /></label></div>
            <label className="mt-4 grid gap-1.5 text-sm font-medium">Introduction<textarea className={`${input} min-h-28`} maxLength={2000} placeholder="Explain what this feedback is for" value={introduction} onChange={(event) => setIntroduction(event.target.value)} /></label>
            <label className="mt-4 flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={questions.some((question) => question.id === "identity")} onChange={(event) => setIdentityQuestion(event.target.checked)} />{language === "de" ? "Name oder Kontaktdaten abfragen" : "Include name or contact details"}</label>
            <FeedbackQuestionEditor questions={questions} onChange={setQuestions} />
            {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}<button className={`${button} mt-5 w-full bg-primary text-primary-foreground hover:bg-primary/90`} disabled={busy}>Save form</button>
          </form>
          <section className="hidden lg:block"><h2 className="text-lg font-semibold">Responses</h2><div className="mt-3 grid gap-2">{submissions.length ? submissions.map((submission) => <SubmissionLink key={submission.id} submission={submission} />) : <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">No responses yet.</p>}</div></section>
        </div>
        <aside className="grid gap-4 self-start">
          <button className="rounded-2xl border bg-card/80 p-5 text-left font-semibold lg:hidden" type="button" aria-expanded={mobileToolsOpen} aria-controls="feedback-more-tools" onClick={() => setMobileToolsOpen((open) => !open)}>More tools <span className="mt-1 block text-xs font-normal text-muted-foreground">Link settings, schema, export, and deletion</span></button>
          <div id="feedback-more-tools" className={`${mobileToolsOpen ? "grid" : "hidden"} gap-4 lg:grid`}>
          <details className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.05] p-5" open><summary className="cursor-pointer font-semibold">Schema prompt <span className="ml-2 rounded-full border border-emerald-500/25 px-2 py-0.5 text-[10px] font-medium text-emerald-300">Version 2</span></summary><p className="mt-3 text-sm text-muted-foreground">The prompt collects the form topic, audience, goals, constraints, language, and tone before generating it.</p><div className="mt-3 rounded-xl border border-emerald-500/20 bg-background/70 p-3 font-mono text-xs leading-5 text-emerald-200">Ask before writing JSON:<br />language · topic · audience · goals · constraints · tone</div><div className="mt-3 grid grid-cols-2 gap-2"><button className={button} type="button" onClick={() => copySchema("json")}>Copy JSON</button><button className={`${button} bg-primary text-primary-foreground hover:bg-primary/90`} type="button" onClick={() => copySchema("prompt")}>Copy prompt</button></div><textarea className={`${input} mt-3 min-h-48 font-mono text-xs`} placeholder="Paste Feedback schema JSON here" value={schemaText} onChange={(event) => setSchemaText(event.target.value)} /><button className={`${button} mt-2 w-full`} type="button" disabled={!schemaText.trim()} onClick={applySchema}>Apply pasted JSON</button>{schemaNotice ? <p className="mt-2 text-xs text-muted-foreground" role="status">{schemaNotice}</p> : null}</details>
          <section className={`${card} p-5`}><h2 className="font-semibold">Public link</h2><p className="mt-1 break-all text-xs text-muted-foreground">{publicUrl}</p><div className="mt-3 grid grid-cols-2 gap-2"><button className={button} type="button" onClick={() => void copyFeedbackText(publicUrl, "Link copied")}>Copy link</button><a className={button} href={publicUrl} target="_blank" rel="noreferrer">Preview</a></div><div className="mt-2 grid grid-cols-2 gap-2"><button className={button} disabled={busy} onClick={() => run(() => setFeedbackFormStatus({ data: { formId: form.id, status: form.status === "active" ? "closed" : "active" } }))}>{form.status === "active" ? "Close" : "Activate"}</button><button className={button} disabled={busy} onClick={() => window.confirm("Rotate this link? The current link will stop working.") && run(() => rotateFeedbackToken({ data: { formId: form.id } }))}>Rotate link</button></div><a className={`${button} mt-2 w-full`} href={`/api/feedback/forms/${form.id}/export`}>Export CSV</a></section>
          <section className="rounded-2xl border border-destructive/35 p-5"><h2 className="font-semibold text-destructive">Delete form</h2><p className="mt-1 text-sm text-muted-foreground">This permanently deletes every response.</p><button className={`${button} mt-3 w-full text-destructive`} disabled={busy} onClick={remove}>Delete permanently</button></section>
          </div>
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
function identityQuestion(language: FeedbackLanguage): FeedbackQuestion { return { id: "identity", kind: "short_text", prompt: language === "de" ? "Dein Name oder deine Kontaktdaten" : "Your name or contact details" }; }
function displayAnswer(question: FeedbackQuestion, answer: string | undefined) { if (!answer || question.kind !== "choice") return answer; const index = question.options?.indexOf(answer) ?? -1; return index >= 0 ? question.optionLabels?.[index] ?? answer : answer; }
function SubmissionLink({ submission }: { submission: FeedbackSubmission }) { return <Link to="/feedback/responses/$submissionId" params={{ submissionId: submission.id }} className="rounded-xl border bg-card/80 p-4 transition-colors hover:bg-accent"><div className="flex justify-between gap-4"><span className="font-medium">{submission.answers.identity || "Anonymous response"}</span><time className="shrink-0 text-xs text-muted-foreground">{new Date(submission.submittedAt).toLocaleString()}</time></div><p className="mt-1 text-sm text-muted-foreground">{submission.answers.comfort || "No comfort rating"} · {submission.reviewState}</p></Link>; }

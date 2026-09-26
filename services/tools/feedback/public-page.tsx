"use client";

import { feedbackChoiceDetailsKey, type LocalizedFeedbackForm, type SharedFeedbackResponse } from "./domain.js";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

export function PublicFeedbackPage({ form, submitted, error, shareUrl, shareExpiresAt, preview = false }: { form: LocalizedFeedbackForm; submitted: boolean; error?: string; shareUrl?: string; shareExpiresAt?: string; preview?: boolean }) {
  const [submitError, setSubmitError] = useState(error);
  const [submitting, setSubmitting] = useState(false);
  const de = form.locale === "de";
  const offersFollowUp = form.questions.some((question) => question.id === "follow_up_contact");
  const errorMessage = submitError === "follow_up_contact_required"
    ? (de ? "Bitte gib eine Kontaktmöglichkeit für die Rückfrage oder das Treffen an." : "Add a way to contact you for the follow-up or meeting.")
    : submitError === "invalid_share_duration"
      ? (de ? "Bitte wähle eine gültige Laufzeit für den Link." : "Choose a valid sharing period.")
    : (de ? "Bitte beantworte mindestens eine Frage und prüfe, ob eine Antwort zu lang ist." : "Please write or select at least one answer and check that no answer is too long.");
  if (submitted) return <PublicFrame locale={form.locale} wide><FeedbackThankYou de={de} shareUrl={shareUrl} shareExpiresAt={shareExpiresAt} /></PublicFrame>;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview) return;
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(undefined);
    try {
      const response = await fetch(window.location.pathname, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams(new FormData(event.currentTarget) as unknown as URLSearchParams), credentials: "same-origin" });
      const result = await response.json() as { location?: string; error?: string };
      if (!response.ok || !result.location) { setSubmitError(result.error ?? "submission_failed"); return; }
      window.location.assign(result.location);
    } catch { setSubmitError("submission_failed"); }
    finally { setSubmitting(false); }
  }
  return <PublicFrame locale={form.locale}>{preview ? <p className="mb-5 rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm" role="status">{de ? "Vorschau: Antworten werden nicht gesendet." : "Preview: answers will not be submitted."}</p> : null}<header><p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">{de ? "Private Rückmeldung" : "Private feedback"}</p><h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{form.title}</h1><p className="mt-4 whitespace-pre-wrap text-muted-foreground">{form.introduction}</p></header>{submitError ? <div role="alert" className="mt-6 rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">{errorMessage}</div> : null}<form method="post" onSubmit={(event) => void submit(event)} className="mt-8 grid gap-6"><div className="hidden" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>{form.questions.map((question) => <fieldset key={question.id} className="rounded-xl border bg-card p-5"><legend className="px-1 text-sm font-semibold">{question.prompt}</legend>{question.kind === "choice" ? <><div className="mt-3 grid gap-2">{question.options?.map((option) => <label key={option} className="flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2 hover:bg-accent"><input type="radio" name={question.id} value={option} /><span>{option}</span></label>)}</div><label className="mt-4 grid gap-2 text-sm text-muted-foreground">{de ? "Möchtest du deine Auswahl näher erklären?" : "Would you like to explain your choice?"}<textarea className="min-h-24 w-full rounded-lg border border-input bg-background px-3 py-2 text-foreground" name={feedbackChoiceDetailsKey(question.id)} maxLength={4000} placeholder={de ? "Optional: mehr Kontext zu deiner Antwort" : "Optional: add more context to your answer"} /></label></> : question.kind === "long_text" ? <textarea className="mt-3 min-h-32 w-full rounded-lg border border-input bg-background px-3 py-2" name={question.id} maxLength={4000} /> : <input className="mt-3 w-full rounded-lg border border-input bg-background px-3 py-2" name={question.id} maxLength={300} />}</fieldset>)}<fieldset className="rounded-xl border bg-card p-5"><legend className="px-1 text-sm font-semibold">{de ? "Antwort teilen" : "Share your response"}</legend><p className="mt-2 text-sm text-muted-foreground">{de ? "Optional: Erstelle einen zeitlich begrenzten Link, den du nach dem Absenden weitergeben kannst. Jede Person mit dem Link kann deine Antworten sehen." : "Optional: create a time-limited link to send after submitting. Anyone with the link can read your answers."}</p><label className="mt-3 grid gap-2 text-sm">{de ? "Link gültig für" : "Link valid for"}<select name="__share_days" defaultValue="" className="min-h-11 rounded-lg border border-input bg-background px-3"><option value="">{de ? "Keinen Link erstellen" : "Do not create a link"}</option><option value="1">{de ? "1 Tag" : "1 day"}</option><option value="7">{de ? "7 Tage" : "7 days"}</option><option value="30">{de ? "30 Tage" : "30 days"}</option></select></label></fieldset><button disabled={submitting || preview} className="min-h-12 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-60" type="submit">{submitting ? (de ? "Wird gesendet…" : "Sending…") : de ? "Rückmeldung senden" : "Send feedback"}</button><p className="text-center text-xs text-muted-foreground">{offersFollowUp ? (de ? "Fragen sind freiwillig. Wenn du eine Rückfrage oder ein Treffen möchtest, gib bitte eine Kontaktmöglichkeit an." : "Questions are optional. If you request follow-up or a meeting, add contact details.") : (de ? "Alle Fragen sind freiwillig, aber mindestens eine Antwort ist nötig." : "Every question is optional, but the form needs at least one answer.")}</p></form></PublicFrame>;
}

export function FeedbackConfirmationPage({ locale, shareUrl, shareExpiresAt }: { locale: "en" | "de"; shareUrl?: string; shareExpiresAt?: string }) {
  return <PublicFrame locale={locale} wide><FeedbackThankYou de={locale === "de"} shareUrl={shareUrl} shareExpiresAt={shareExpiresAt} /></PublicFrame>;
}

function FeedbackThankYou({ de, shareUrl, shareExpiresAt }: { de: boolean; shareUrl?: string; shareExpiresAt?: string }) {
  return <section className="feedback-success relative overflow-hidden rounded-3xl border px-6 py-14 text-center shadow-2xl sm:px-12 sm:py-20">
    <div className="feedback-success-glow" aria-hidden="true" />
    <div className="feedback-success-visual" aria-hidden="true">
      <span className="feedback-success-ring" />
      <span className="feedback-success-particle feedback-success-particle-one">+1</span>
      <span className="feedback-success-particle feedback-success-particle-two">+1</span>
      <span className="feedback-success-particle feedback-success-particle-three">+1</span>
      <span className="feedback-success-particle feedback-success-particle-four">+1</span>
      <svg className="feedback-success-heart" viewBox="0 0 64 64" fill="none"><path d="M32 54S9 41 9 22.5C9 14.5 15 9 22.5 9c4.5 0 7.8 2.2 9.5 5.1C33.7 11.2 37 9 41.5 9 49 9 55 14.5 55 22.5 55 41 32 54 32 54Z" fill="currentColor" /><path d="M32 22v16M24 30h16" stroke="var(--primary-foreground)" strokeWidth="4" strokeLinecap="round" /></svg>
    </div>
    <div className="feedback-success-level"><span>LEVEL UP</span></div>
    <h1 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">{de ? "Danke fürs Teilen" : "Thank you for sharing"}</h1>
    <p className="mx-auto mt-4 max-w-md text-base leading-7 text-muted-foreground">{de ? "Deine Rückmeldung wurde gesendet. Danke für deine Ehrlichkeit und deine Zeit." : "Your feedback was sent. Thank you for your honesty and your time."}</p>
    <div className="mx-auto mt-8 max-w-sm text-left">
      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground"><span>{de ? "Vertrauen" : "Trust"}</span><span>+1</span></div>
      <div className="mt-2 h-3 overflow-hidden rounded-full border bg-background"><div className="feedback-success-meter h-full rounded-full bg-primary" /></div>
    </div>
    {shareUrl && shareExpiresAt ? <ShareResponseLink url={shareUrl} expiresAt={shareExpiresAt} de={de} /> : null}
    <p className="mt-8 text-sm text-muted-foreground">{de ? "Du kannst die Seite jetzt schließen." : "You can close this page now."}</p>
  </section>;
}

function PublicFrame({ children, locale, wide = false }: { children: ReactNode; locale: string; wide?: boolean }) { return <main lang={locale} className={`mx-auto min-h-screen ${wide ? "w-[min(860px,calc(100%_-_2rem))]" : "w-[min(680px,calc(100%_-_2rem))]"} py-10 sm:py-16`}>{children}</main>; }

export function SharedFeedbackResponsePage({ response }: { response: SharedFeedbackResponse }) {
  const de = response.language === "de";
  return <PublicFrame locale={response.language}><header><p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">{de ? "Geteilte Rückmeldung" : "Shared feedback"}</p><h1 className="mt-3 text-3xl font-semibold tracking-tight">{response.formTitle}</h1><p className="mt-3 text-sm text-muted-foreground">{de ? "Diese Antwort wurde am" : "Submitted on"} {new Date(response.submittedAt).toLocaleString(response.language)} · {de ? "Link gültig bis" : "Link expires"} {new Date(response.expiresAt).toLocaleString(response.language)}</p></header><div className="mt-8 grid gap-5">{response.questionSnapshot.map((question) => <section key={question.id} className="rounded-xl border bg-card p-5"><h2 className="text-sm font-semibold text-muted-foreground">{question.prompt}</h2><p className="mt-2 whitespace-pre-wrap">{response.answers[question.id] || <span className="text-muted-foreground">{de ? "Keine Antwort" : "No answer"}</span>}</p>{question.kind === "choice" && response.answers[feedbackChoiceDetailsKey(question.id)] ? <p className="mt-4 whitespace-pre-wrap border-t pt-4 text-sm">{response.answers[feedbackChoiceDetailsKey(question.id)]}</p> : null}</section>)}</div></PublicFrame>;
}

function ShareResponseLink({ url, expiresAt, de }: { url: string; expiresAt: string; de: boolean }) {
  const [copied, setCopied] = useState(false);
  const [absoluteUrl, setAbsoluteUrl] = useState(url);
  useEffect(() => { setAbsoluteUrl(new URL(url, window.location.origin).toString()); }, [url]);
  async function copy() { try { await navigator.clipboard.writeText(absoluteUrl); setCopied(true); } catch { setCopied(false); } }
  return <div className="mx-auto mt-8 max-w-lg rounded-xl border bg-card p-5 text-left"><h2 className="font-semibold">{de ? "Deine Antwort weitergeben" : "Share your response"}</h2><p className="mt-2 text-sm text-muted-foreground">{de ? "Jede Person mit diesem Link kann deine Antworten sehen. Gültig bis" : "Anyone with this link can read your answers. Expires"} {new Date(expiresAt).toLocaleString(de ? "de" : "en")}. {de ? "Bewahre den Link auf, wenn du ihn später weitergeben möchtest." : "Keep this link if you want to share it later."}</p><div className="mt-3 flex flex-col gap-2 sm:flex-row"><input className="min-h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm" readOnly value={absoluteUrl} aria-label={de ? "Link zur Antwort" : "Response link"} onFocus={(event) => event.currentTarget.select()} /><button type="button" className="min-h-11 rounded-lg bg-primary px-4 font-semibold text-primary-foreground" onClick={() => void copy()}>{copied ? (de ? "Kopiert" : "Copied") : (de ? "Link kopieren" : "Copy link")}</button></div></div>;
}

import type { LocalizedFeedbackForm } from "./domain.js";
import type { ReactNode } from "react";

export function PublicFeedbackPage({ form, submitted, error }: { form: LocalizedFeedbackForm; submitted: boolean; error?: string }) {
  const de = form.locale === "de";
  const alternate = de ? "en" : "de";
  if (submitted) return <PublicFrame locale={form.locale}><LanguageLink locale={alternate} label={de ? "English" : "Deutsch"} /><FeedbackThankYou de={de} /></PublicFrame>;
  return <PublicFrame locale={form.locale}><LanguageLink locale={alternate} label={de ? "English" : "Deutsch"} /><header><p className="font-mono text-xs uppercase tracking-[0.18em] text-primary">{de ? "Private Rückmeldung" : "Private feedback"}</p><h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{form.title}</h1><p className="mt-4 whitespace-pre-wrap text-muted-foreground">{form.introduction}</p></header>{error ? <div role="alert" className="mt-6 rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">{de ? "Bitte beantworte mindestens eine Frage und prüfe, ob eine Antwort zu lang ist." : "Please write or select at least one answer and check that no answer is too long."}</div> : null}<form method="post" className="mt-8 grid gap-6"><div className="hidden" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>{form.questions.map((question) => <fieldset key={question.id} className="rounded-xl border bg-card p-5"><legend className="px-1 text-sm font-semibold">{question.prompt}</legend>{question.kind === "choice" ? <div className="mt-3 grid gap-2">{question.options?.map((option, index) => <label key={option} className="flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2 hover:bg-accent"><input type="radio" name={question.id} value={option} /><span>{question.optionLabels?.[index] ?? option}</span></label>)}</div> : question.kind === "long_text" ? <textarea className="mt-3 min-h-32 w-full rounded-lg border bg-background px-3 py-2" name={question.id} maxLength={4000} /> : <input className="mt-3 w-full rounded-lg border bg-background px-3 py-2" name={question.id} maxLength={300} />}</fieldset>)}<button className="min-h-12 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground" type="submit">{de ? "Rückmeldung senden" : "Send feedback"}</button><p className="text-center text-xs text-muted-foreground">{de ? "Alle Fragen sind freiwillig, aber mindestens eine Antwort ist nötig." : "Every question is optional, but the form needs at least one answer."}</p></form></PublicFrame>;
}

function FeedbackThankYou({ de }: { de: boolean }) {
  return <section className="feedback-success relative overflow-hidden rounded-3xl border border-primary/30 bg-card px-6 py-12 text-center shadow-2xl sm:px-12 sm:py-16">
    <div className="feedback-success-glow" aria-hidden="true" />
    <div className="feedback-success-visual" aria-hidden="true">
      <span className="feedback-success-ring" />
      <span className="feedback-success-particle feedback-success-particle-one">+</span>
      <span className="feedback-success-particle feedback-success-particle-two">+</span>
      <span className="feedback-success-particle feedback-success-particle-three">+</span>
      <svg className="feedback-success-heart" viewBox="0 0 64 64" fill="none"><path d="M32 54S9 41 9 22.5C9 14.5 15 9 22.5 9c4.5 0 7.8 2.2 9.5 5.1C33.7 11.2 37 9 41.5 9 49 9 55 14.5 55 22.5 55 41 32 54 32 54Z" fill="currentColor" /><path d="M32 22v16M24 30h16" stroke="var(--primary-foreground)" strokeWidth="4" strokeLinecap="round" /></svg>
    </div>
    <div className="feedback-success-level"><span>{de ? "LEVEL AUF" : "LEVEL UP"}</span><strong>{de ? "+1 Vertrauen" : "+1 trust"}</strong></div>
    <h1 className="mt-6 text-3xl font-semibold tracking-tight sm:text-4xl">{de ? "Danke für deine Rückmeldung" : "Thank you for your feedback"}</h1>
    <p className="mx-auto mt-4 max-w-md text-base leading-7 text-muted-foreground">{de ? "Deine Antwort ist angekommen. Ein bisschen Ehrlichkeit heilt manchmal erstaunlich viel." : "Your response made it through. A little honesty can restore a surprising amount."}</p>
    <div className="mx-auto mt-8 max-w-sm text-left">
      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground"><span>{de ? "Verbindung" : "Connection"}</span><span>{de ? "Geheilt" : "Healed"}</span></div>
      <div className="mt-2 h-3 overflow-hidden rounded-full border bg-background"><div className="feedback-success-meter h-full rounded-full bg-primary" /></div>
    </div>
    <p className="mt-8 text-sm text-muted-foreground">{de ? "Du kannst diese Seite jetzt schließen." : "You can close this page now."}</p>
  </section>;
}

function PublicFrame({ children, locale }: { children: ReactNode; locale: string }) { return <main lang={locale} className="mx-auto min-h-screen w-[min(680px,calc(100%_-_2rem))] py-10 sm:py-16">{children}</main>; }
function LanguageLink({ locale, label }: { locale: string; label: string }) { return <div className="mb-6 flex justify-end"><a className="rounded-full border px-3 py-1 text-sm hover:bg-accent" href={`?lang=${locale}`}>{label}</a></div>; }

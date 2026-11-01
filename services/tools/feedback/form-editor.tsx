"use client";

import { Link, useBlocker, useNavigate, useRouter } from "@tanstack/react-router";
import { CopyIcon, MoreHorizontalIcon } from "lucide-react";
import { useRef, useState } from "react";
import { AppShell } from "../src/components/app-shell.js";
import { PageHeader } from "../src/components/page-header.js";
import { Segmented } from "../src/components/segmented.js";
import { Button, buttonVariants } from "../src/components/ui/button.js";
import { Checkbox } from "../src/components/ui/checkbox.js";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../src/components/ui/dialog.js";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../src/components/ui/dropdown-menu.js";
import { Input } from "../src/components/ui/input.js";
import { Label } from "../src/components/ui/label.js";
import { Textarea } from "../src/components/ui/textarea.js";
import { favicons } from "../src/favicons.js";
import { countLabel } from "../src/lib/count-label.js";
import { cn } from "../src/lib/utils.js";
import { copyFeedbackText } from "./clipboard.js";
import type { FeedbackForm, FeedbackLanguage, FeedbackQuestion } from "./domain.js";
import { FeedbackQuestionEditor } from "./question-editor.js";
import { feedbackSchemaJson, feedbackSchemaPrompt, parseFeedbackSchemaJson, type FeedbackEditableContent } from "./schema-exchange.js";
import { deleteFeedbackForm, rotateFeedbackToken, setFeedbackFormStatus, updateFeedbackForm } from "./server-functions.js";
import { ConfirmDialog, FormStatusBadge, feedbackErrorMessage, formatRecentDay } from "./ui.js";

function draftOf(form: FeedbackEditableContent): FeedbackEditableContent {
  return { language: form.language, title: form.title, introduction: form.introduction, questions: form.questions };
}

/** True when the editor holds changes that are not saved. */
export function feedbackDraftChanged(form: FeedbackEditableContent, draft: FeedbackEditableContent) {
  return JSON.stringify(draftOf(form)) !== JSON.stringify(draftOf(draft));
}

export function FeedbackFormPage({ form, publicOrigin }: { form: FeedbackForm; publicOrigin: string }) {
  const router = useRouter();
  const navigate = useNavigate();
  const [draft, setDraft] = useState(() => draftOf(form));
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saveError, setSaveError] = useState<string>();
  const [dialog, setDialog] = useState<"schema" | "rotate" | "delete">();
  const allowLeave = useRef(false);
  const unsaved = feedbackDraftChanged(form, draft);
  useBlocker({ disabled: !unsaved, enableBeforeUnload: unsaved, shouldBlockFn: () => !allowLeave.current && !window.confirm("Discard unsaved form changes?") });
  const publicUrl = `${publicOrigin}/feedback/f/${form.publicToken}`;
  const change = (next: Partial<FeedbackEditableContent>) => setDraft((current) => ({ ...current, ...next }));
  const updated = formatRecentDay(form.updatedAt);

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError(undefined);
    try { await action(); await router.invalidate(); } catch (caught) { setError(feedbackErrorMessage(caught)); } finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setSaveError(undefined);
    try {
      const saved = await updateFeedbackForm({ data: { formId: form.id, ...draft } });
      // The server trims the text, so the saved form is the new baseline.
      if (saved) setDraft(draftOf(saved));
      await router.invalidate();
    } catch (caught) { setSaveError(feedbackErrorMessage(caught)); } finally { setBusy(false); }
  }
  function setIdentityQuestion(enabled: boolean) {
    const identity = identityQuestion(draft.language);
    const others = draft.questions.filter((question) => question.id !== "identity");
    const existing = draft.questions.some((question) => question.id === "identity");
    change({ questions: !enabled ? others : existing ? draft.questions.map((question) => question.id === "identity" ? identity : question) : [...draft.questions, identity] });
  }
  async function remove() {
    await deleteFeedbackForm({ data: { formId: form.id } });
    allowLeave.current = true;
    try { await navigate({ to: "/feedback/forms" }); } catch (caught) { allowLeave.current = false; throw caught; }
  }

  return <>
    <AppShell product="Feedback" icon={favicons.feedback} accent="rose" />
    <main id="main" className="tools-page">
      <PageHeader
        parent={{ label: "Forms", to: "/feedback/forms" }}
        title={<><span className="min-w-0 wrap-anywhere">{form.title || "Untitled form"}</span><FormStatusBadge status={form.status} /></>}
        facts={`${countLabel(form.responseCount, "response")} · ${form.unreadCount.toLocaleString("en-GB")} unread · updated ${updated === "Today" || updated === "Yesterday" ? updated.toLowerCase() : updated}`}
        actions={<>
          <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-sm:hidden")} to="/feedback" search={{ form: form.id, filter: "all" }}>Responses</Link>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="icon-sm" aria-label="Form actions" disabled={busy} />}><MoreHorizontalIcon /></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => void run(() => setFeedbackFormStatus({ data: { formId: form.id, status: form.status === "active" ? "closed" : "active" } }))}>{form.status === "active" ? "Close form" : "Activate form"}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDialog("rotate")}>Rotate link…</DropdownMenuItem>
              <DropdownMenuItem render={<a href={`/api/feedback/forms/${form.id}/export`} download />}>Export CSV</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDialog("schema")}>Schema prompt and JSON…</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setDialog("delete")}>Delete form…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>}
      />
      {error ? <p className="mb-3 text-sm text-destructive" role="alert">{error}</p> : null}
      <div className="mb-3 flex min-w-0 items-center gap-1.5 rounded-[10px] border border-control-border bg-field py-1 pr-1 pl-2.5">
        <span className="text-[0.8125rem] whitespace-nowrap text-muted-foreground">Public link</span>
        <code className="min-w-0 flex-1 truncate font-mono text-[0.8125rem]">{publicUrl}</code>
        <Button size="sm" onClick={() => void copyFeedbackText(publicUrl, "Link copied")}><CopyIcon data-icon="inline-start" />Copy</Button>
      </div>
      <div className="mb-3 lg:hidden">
        <Segmented label="Editor view" options={[["edit", "Edit"], ["preview", "Preview"]]} value={view} onValue={setView} />
      </div>
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className={cn("grid min-w-0 gap-3", view === "preview" && "max-lg:hidden")}>
          <section className="rounded-xl border bg-card" aria-labelledby="feedback-form-text-title">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
              <h2 id="feedback-form-text-title" className="text-sm font-semibold">Form text</h2>
              <Segmented label="Form language" options={[["en", "English"], ["de", "German"]]} value={draft.language} onValue={(language: FeedbackLanguage) => change({ language })} />
            </div>
            <div className="grid gap-2.5 px-4 pt-2.5 pb-3.5">
              <div className="grid gap-1.5">
                <Label htmlFor="feedback-title">Title</Label>
                <Input id="feedback-title" maxLength={120} placeholder="Enter a title" value={draft.title} onChange={(event) => change({ title: event.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="feedback-introduction">Introduction</Label>
                <Textarea id="feedback-introduction" rows={3} maxLength={2000} placeholder="Explain what this feedback is for" value={draft.introduction} onChange={(event) => change({ introduction: event.target.value })} />
              </div>
              <label className="flex w-fit items-center gap-2 text-[0.8125rem]">
                <Checkbox checked={draft.questions.some((question) => question.id === "identity")} onCheckedChange={setIdentityQuestion} />
                Ask for a name or contact details
              </label>
            </div>
          </section>
          <FeedbackQuestionEditor questions={draft.questions} language={draft.language} onChange={(questions) => change({ questions })} />
        </div>
        <section className={cn("min-w-0 rounded-xl border bg-card lg:sticky lg:top-3", view === "edit" && "max-lg:hidden")} aria-labelledby="feedback-preview-title">
          <div className="px-4 pt-3">
            <h2 id="feedback-preview-title" className="text-sm font-semibold">Preview</h2>
            <p className="text-xs text-muted-foreground">What people see · updates as you type</p>
          </div>
          <div className="px-4 pt-2.5 pb-3.5">
            <FormPreview draft={draft} />
          </div>
        </section>
      </div>
      {unsaved ? <div className="sticky bottom-3 z-20 mx-auto mt-3 flex w-max max-w-full flex-wrap items-center gap-2.5 rounded-full border bg-popover py-1.5 pr-2 pl-4 text-[0.8125rem] shadow-lg max-sm:rounded-2xl">
        <p role="status">Unsaved changes</p>
        {saveError ? <p className="text-destructive" role="alert">{saveError}</p> : null}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setDraft(draftOf(form)); setSaveError(undefined); }}>Discard</Button>
        <Button size="sm" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</Button>
      </div> : null}
      <SchemaDialog open={dialog === "schema"} onOpenChange={(open) => setDialog(open ? "schema" : undefined)} draft={draft} onApply={setDraft} />
      <ConfirmDialog open={dialog === "rotate"} onOpenChange={(open) => setDialog(open ? "rotate" : undefined)} title="Rotate the public link?" description="The current link stops working. Send the new link to people who still need to answer." action="Rotate link" onConfirm={async () => { await rotateFeedbackToken({ data: { formId: form.id } }); await router.invalidate(); }} />
      <ConfirmDialog open={dialog === "delete"} onOpenChange={(open) => setDialog(open ? "delete" : undefined)} title="Delete this form?" description={`This deletes ${form.title || "this form"} and all ${countLabel(form.responseCount, "response")} permanently. You cannot undo it.`} action="Delete form" destructive onConfirm={remove} />
    </main>
  </>;
}

/** A compact copy of the public form, drawn from the unsaved editor state. It cannot submit. */
function FormPreview({ draft }: { draft: FeedbackEditableContent }) {
  const de = draft.language === "de";
  return (
    <div className="grid max-h-[calc(100dvh-12rem)] gap-2.5 overflow-y-auto rounded-[22px] border bg-background px-3.5 py-4 text-[0.8125rem]" lang={draft.language}>
      <h3 className="text-[1.0625rem] font-semibold wrap-anywhere">{draft.title || (de ? "Ohne Titel" : "Untitled form")}</h3>
      {draft.introduction ? <p className="line-clamp-3 whitespace-pre-wrap text-muted-foreground">{draft.introduction}</p> : null}
      {draft.questions.map((question) => <div key={question.id} className="grid gap-1.5 rounded-[10px] border bg-card p-2.5">
        <p className="font-semibold wrap-anywhere">{question.prompt || "…"}</p>
        {question.kind === "choice"
          ? question.options?.map((option, index) => <span key={index} className="flex min-h-7 items-center gap-2 rounded-[7px] border px-2 py-1 wrap-anywhere"><span className="size-[11px] shrink-0 rounded-full border border-muted-foreground" aria-hidden="true" />{option || "…"}</span>)
          : <span className={cn("rounded-[7px] border border-control-border bg-field", question.kind === "long_text" ? "h-14" : "h-8")} aria-hidden="true" />}
      </div>)}
      <button type="button" disabled className="h-8 rounded-full bg-primary font-semibold text-primary-foreground">{de ? "Rückmeldung senden" : "Send feedback"}</button>
    </div>
  );
}

function SchemaDialog({ open, onOpenChange, draft, onApply }: { open: boolean; onOpenChange: (open: boolean) => void; draft: FeedbackEditableContent; onApply: (draft: FeedbackEditableContent) => void }) {
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<string>();
  async function copy(kind: "json" | "prompt") {
    const value = kind === "json" ? feedbackSchemaJson(draft) : feedbackSchemaPrompt(draft);
    setText(value);
    const copied = await copyFeedbackText(value, kind === "json" ? "JSON copied" : "Prompt copied");
    setNotice(copied ? undefined : "Copy failed. Copy the text from the box.");
  }
  function apply() {
    try {
      onApply(draftOf(parseFeedbackSchemaJson(text)));
      setNotice(undefined);
      onOpenChange(false);
    } catch (caught) { setNotice(feedbackErrorMessage(caught)); }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Schema prompt and JSON</DialogTitle>
          <DialogDescription>Copy the prompt into an AI chat. It asks for the topic, audience, goals, limits, language and tone, then writes the form as JSON. Paste that JSON here and apply it. Save the form to keep it.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void copy("prompt")}>Copy prompt</Button>
          <Button variant="outline" onClick={() => void copy("json")}>Copy JSON</Button>
        </div>
        <Textarea className="min-h-48 font-mono text-xs" aria-label="Feedback schema JSON" placeholder="Paste Feedback schema JSON here" value={text} onChange={(event) => setText(event.target.value)} />
        {notice ? <p className="text-sm text-destructive" role="alert">{notice}</p> : null}
        <DialogFooter>
          <Button variant="outline" disabled={!text.trim()} onClick={apply}>Apply pasted JSON</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function identityQuestion(language: FeedbackLanguage): FeedbackQuestion { return { id: "identity", kind: "short_text", prompt: language === "de" ? "Dein Name oder deine Kontaktdaten" : "Your name or contact details" }; }

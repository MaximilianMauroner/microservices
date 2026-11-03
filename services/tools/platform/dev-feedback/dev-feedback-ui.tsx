import { useRouter, useRouterState } from "@tanstack/react-router";
import { BugIcon, CheckIcon, LightbulbIcon, MessageSquareWarningIcon, RotateCcwIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "../ui/components/ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/components/ui/dialog.js";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/components/ui/sidebar.js";
import { Textarea } from "../ui/components/ui/textarea.js";
import { toast } from "../ui/components/ui/toast.js";
import { formatDateTime } from "../ui/lib/format-date.js";
import type { DevFeedback, DevFeedbackKind } from "./dev-feedback.js";
import { sendDevFeedback, setDevFeedbackState } from "./server-functions.js";

const KINDS = [
  { kind: "bug", label: "Bug report", Icon: BugIcon, prompt: "What went wrong? What did you expect?" },
  { kind: "feature", label: "Idea", Icon: LightbulbIcon, prompt: "What should Tools do that it does not do now?" }
] as const satisfies readonly { kind: DevFeedbackKind; label: string; Icon: typeof BugIcon; prompt: string }[];

/** A sidebar button that lets anyone signed in report a bug or request a feature from the page they are on. */
export function SendFeedbackButton() {
  const page = useRouterState({ select: (state) => state.location.href });
  const sidebar = useSidebar();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<DevFeedbackKind>("bug");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function send(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(undefined);
    try {
      await sendDevFeedback({ data: { kind, message, page } });
      setOpen(false); setMessage(""); sidebar.setOpenMobile(false);
      toast.add({ title: "Report sent", description: "Thanks. The developer reads every report.", type: "success" });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The report could not be sent. Try again."); }
    finally { setBusy(false); }
  }

  const current = KINDS.find((item) => item.kind === kind)!;
  return <>
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton className="h-9 px-2.5 text-sm" tooltip="Report a bug or idea" onClick={() => { setError(undefined); setOpen(true); }}>
          <MessageSquareWarningIcon />
          <span>Report a bug or idea</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="w-[min(30rem,calc(100vw_-_2rem))]">
        <form onSubmit={(event) => void send(event)} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Report a bug or idea</DialogTitle>
            <DialogDescription>Tell the developer what is broken or what you would like. The page you are on is sent with it.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Report type">
            {KINDS.map(({ kind: value, label, Icon }) => <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)} className={`flex h-10 items-center justify-center gap-2 rounded-lg border text-sm ${kind === value ? "border-primary bg-primary/10 font-medium text-foreground" : "text-muted-foreground hover:bg-accent"}`}><Icon className="size-4" />{label}</button>)}
          </div>
          <Textarea aria-label="Message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder={current.prompt} maxLength={4000} rows={5} className="min-h-28" required autoFocus />
          <p className="truncate text-xs text-muted-foreground">Page: <span className="font-mono">{page}</span></p>
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !message.trim()}>{busy ? "Sending…" : "Send report"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}

/** The admin's list of bug reports and feature requests about Tools. */
export function DevFeedbackSettings({ items }: { items: readonly DevFeedback[] }) {
  const router = useRouter();
  const [showDone, setShowDone] = useState(false);
  const [busyId, setBusyId] = useState<string>();
  const open = items.filter((item) => item.state === "open");
  const visible = showDone ? items : open;

  async function mark(item: DevFeedback) {
    setBusyId(item.id);
    try {
      await setDevFeedbackState({ data: { id: item.id, state: item.state === "open" ? "done" : "open" } });
      await router.invalidate();
    } catch (caught) { toast.add({ title: "Could not update the report", description: caught instanceof Error ? caught.message : undefined, type: "error" }); }
    finally { setBusyId(undefined); }
  }

  return <section className="mt-8 max-w-3xl" aria-labelledby="dev-feedback-title">
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 id="dev-feedback-title" className="text-sm font-semibold">Bug reports and ideas <span className="font-normal text-muted-foreground">{open.length} open</span></h2>
      {items.length > open.length ? <button type="button" aria-pressed={showDone} onClick={() => setShowDone((value) => !value)} className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent">{showDone ? "Hide done" : `Show done ${items.length - open.length}`}</button> : null}
    </div>
    <ul className="divide-y overflow-hidden rounded-xl border bg-card">
      {visible.length ? visible.map((item) => {
        const { Icon, label } = KINDS.find((entry) => entry.kind === item.kind)!;
        return <li key={item.id} className={`flex items-start gap-3 px-3 py-3 ${item.state === "done" ? "opacity-60" : ""}`}>
          <Icon className={`mt-0.5 size-4 shrink-0 ${item.kind === "bug" ? "text-destructive" : "text-primary"}`} aria-label={label} />
          <div className="min-w-0 flex-1">
            <p className="whitespace-pre-wrap text-sm">{item.message}</p>
            <p className="mt-1 truncate text-xs text-muted-foreground">{item.authorEmail} · <a className="font-mono hover:text-foreground" href={item.page}>{item.page}</a> · {formatDateTime(item.createdAt)}</p>
          </div>
          <Button size="sm" variant="ghost" disabled={busyId === item.id} onClick={() => void mark(item)}>{item.state === "open" ? <><CheckIcon />Mark done</> : <><RotateCcwIcon />Reopen</>}</Button>
        </li>;
      }) : <li className="p-5 text-sm text-muted-foreground">No open bug reports or ideas.</li>}
    </ul>
  </section>;
}

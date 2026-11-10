import { useRouter, useRouterState } from "@tanstack/react-router";
import { BugIcon, CheckIcon, ExternalLinkIcon, LightbulbIcon, MessageSquareWarningIcon, RotateCcwIcon } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Button, buttonVariants } from "../ui/components/ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/components/ui/dialog.js";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/components/ui/sidebar.js";
import { Textarea } from "../ui/components/ui/textarea.js";
import { toast } from "../ui/components/ui/toast.js";
import { formatDateTime } from "../ui/lib/format-date.js";
import { Segmented } from "../ui/components/segmented.js";
import { githubIssueUrl, REPORT_APPS, type DevFeedback, type DevFeedbackKind, type DevFeedbackState, type ReportApp } from "./report.js";
import { sendDevFeedback, setDevFeedbackState } from "./server-functions.js";

const KINDS = [
  { kind: "bug", label: "Bug report", Icon: BugIcon, prompt: "What went wrong? What did you expect?", details: "How can the developer make it happen again? (optional)", detailsTitle: "How to make it happen again" },
  { kind: "feature", label: "Idea", Icon: LightbulbIcon, prompt: "What should Tools do that it does not do now?", details: "Why would it help you? (optional)", detailsTitle: "Why it would help" }
] as const satisfies readonly { kind: DevFeedbackKind; label: string; Icon: typeof BugIcon; prompt: string; details: string; detailsTitle: string }[];

/** A sidebar button that lets anyone signed in report a bug or request a feature from the page they are on. */
export function SendFeedbackButton() {
  const page = useRouterState({ select: (state) => state.location.href });
  const sidebar = useSidebar();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<DevFeedbackKind>("bug");
  const [message, setMessage] = useState("");
  const [details, setDetails] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function send(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(undefined);
    try {
      await sendDevFeedback({ data: { kind, message, details, page, anonymous } });
      setOpen(false); setMessage(""); setDetails(""); sidebar.setOpenMobile(false);
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
          <Textarea aria-label={current.details} value={details} onChange={(event) => setDetails(event.target.value)} placeholder={current.details} maxLength={4000} rows={3} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} />Send anonymously, without your name and email</label>
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

const STATE_VIEWS = [["open", "Open"], ["tracked", "On GitHub"], ["done", "Done"]] as const satisfies readonly (readonly [DevFeedbackState, string])[];
const APP_VIEWS = [["all", "All apps"], ...Object.entries(REPORT_APPS)] as readonly (readonly ["all" | ReportApp, string])[];

/** The admin's inbox of bug reports and ideas from every app. A report moves from open to a GitHub issue to done. */
export function ReportsInbox({ items, reportsUrl }: { items: readonly DevFeedback[]; reportsUrl: string }) {
  const router = useRouter();
  const [state, setState] = useState<DevFeedbackState>("open");
  const [app, setApp] = useState<"all" | ReportApp>("all");
  const [busyId, setBusyId] = useState<string>();
  const ofApp = items.filter((item) => app === "all" || item.app === app);
  const visible = ofApp.filter((item) => item.state === state);
  const count = (value: DevFeedbackState) => ofApp.filter((item) => item.state === value).length;

  useEffect(() => {
    const linked = items.find((item) => `#${item.id}` === window.location.hash);
    if (!linked) return;
    setState(linked.state);
    setApp("all");
    requestAnimationFrame(() => document.getElementById(linked.id)?.scrollIntoView({ block: "center" }));
  }, []);

  async function move(item: DevFeedback, next: DevFeedbackState) {
    setBusyId(item.id);
    try {
      await setDevFeedbackState({ data: { id: item.id, state: next } });
      await router.invalidate();
    } catch (caught) { toast.add({ title: "Could not update the report", description: caught instanceof Error ? caught.message : undefined, type: "error" }); }
    finally { setBusyId(undefined); }
  }

  return <section aria-label="Reports" className="max-w-4xl">
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Segmented label="Report state" value={state} onValue={setState} options={STATE_VIEWS.map(([value, label]) => [value, <>{label} <span className="text-muted-foreground">{count(value)}</span></>] as const)} />
      <Segmented label="App" value={app} onValue={setApp} options={APP_VIEWS} />
    </div>
    <ul className="divide-y overflow-hidden rounded-xl border bg-card">
      {visible.length ? visible.map((item) => {
        const { Icon, label, detailsTitle } = KINDS.find((entry) => entry.kind === item.kind)!;
        const from = item.authorEmail ?? (item.contactEmail ? `${item.contactEmail} (not signed in)` : "Anonymous");
        return <li key={item.id} id={item.id} className="flex flex-col gap-2 px-3 py-3 target:bg-primary/5 sm:flex-row sm:items-start sm:gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <Icon className={`mt-0.5 size-4 shrink-0 ${item.kind === "bug" ? "text-destructive" : "text-primary"}`} aria-label={label} />
            <div className="min-w-0 flex-1">
              <p className="whitespace-pre-wrap text-sm">{item.message}</p>
              {item.details ? <div className="mt-2 border-l-2 pl-3 text-sm"><p className="text-xs font-medium text-muted-foreground">{detailsTitle}</p><p className="whitespace-pre-wrap">{item.details}</p></div> : null}
              <p className="mt-1 text-xs text-muted-foreground">
                <span className="font-medium text-foreground/80">{REPORT_APPS[item.app]}</span> · {from} · {item.app === "tools" ? <a className="font-mono hover:text-foreground" href={item.page}>{item.page}</a> : <span className="font-mono">{item.page}</span>} · {formatDateTime(item.createdAt)}
                {item.context ? <span className="block truncate">{item.context}</span> : null}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-1 pl-7 sm:pl-0">
            {item.state === "open" ? <a className={buttonVariants({ size: "sm", variant: "outline" })} href={githubIssueUrl(item, reportsUrl)} target="_blank" rel="noreferrer" onClick={() => void move(item, "tracked")}><ExternalLinkIcon />Open issue</a> : null}
            {item.state === "done"
              ? <Button size="sm" variant="ghost" disabled={busyId === item.id} onClick={() => void move(item, "open")}><RotateCcwIcon />Reopen</Button>
              : <Button size="sm" variant="ghost" disabled={busyId === item.id} onClick={() => void move(item, "done")}><CheckIcon />Done</Button>}
          </div>
        </li>;
      }) : <li className="p-5 text-sm text-muted-foreground">{state === "open" ? "No open bug reports or ideas." : state === "tracked" ? "No reports wait on a GitHub issue." : "No reports are done yet."}</li>}
    </ul>
  </section>;
}

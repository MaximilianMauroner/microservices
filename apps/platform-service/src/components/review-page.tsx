import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { FilterIcon, InboxIcon } from "lucide-react";
import type {
  Candidate,
  Decision,
  DecisionFeedback,
  DecisionRecordItem,
  DecisionReviewState,
  QueueItem,
  Scope
} from "@tools-platform/field-guide";
import { AppShell } from "./app-shell.js";
import { AppSelect } from "./form-controls.js";
import { Alert } from "./ui/alert.js";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion.js";
import { Badge } from "./ui/badge.js";
import { Button } from "./ui/button.js";
import { ButtonGroup } from "./ui/button-group.js";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card.js";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog.js";
import { Empty as EmptyRoot, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty.js";
import { Input } from "./ui/input.js";
import { Label } from "./ui/label.js";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "./ui/popover.js";
import { ScrollArea } from "./ui/scroll-area.js";
import { Separator } from "./ui/separator.js";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table.js";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs.js";
import { Textarea } from "./ui/textarea.js";
import type { ReviewPageData, ReviewView } from "../protected-data.js";

export type ReviewSearch = {
  scope: Scope;
  view: ReviewView;
  reviewState: DecisionReviewState;
  projectKey?: string;
  taskId?: string;
  device?: string;
  harness?: string;
  skill?: string;
  from?: string;
  to?: string;
};

type DecisionsPageData = ReviewPageData & { decisions: NonNullable<ReviewPageData["decisions"]> };
type QueuePageData = ReviewPageData & { queue: NonNullable<ReviewPageData["queue"]> };

export function ReviewPage({ initial, search }: { initial: ReviewPageData; search: ReviewSearch }) {
  const [data, setData] = useState(initial);
  const [notice, setNotice] = useState<{ text: string; tone: "success" | "error" }>();

  useEffect(() => setData(initial), [initial]);

  async function loadMore() {
    if (data.view === "decisions" && data.decisions?.nextCursor) {
      const params = new URLSearchParams({ reviewState: data.reviewState, limit: "25", cursor: data.decisions.nextCursor });
      addSearchFilters(params, search);
      const response = await fetch(`/api/review/decision-records?${params}`, { credentials: "same-origin" });
      if (!response.ok) return;
      const page = await response.json() as NonNullable<ReviewPageData["decisions"]>;
      setData((current) => current.decisions ? { ...current, decisions: { ...page, items: [...current.decisions.items, ...page.items] } } : current);
    }
    if (data.view === "history" && data.history?.nextCursor) {
      const params = new URLSearchParams({ scope: search.scope, limit: "25", cursor: data.history.nextCursor });
      const response = await fetch(`/api/review/history?${params}`, { credentials: "same-origin" });
      if (!response.ok) return;
      const page = await response.json() as NonNullable<ReviewPageData["history"]>;
      setData((current) => current.history ? { ...current, history: { ...page, decisions: [...current.history.decisions, ...page.decisions] } } : current);
    }
  }

  return (
    <>
      <AppShell active="review" />
      <main id="main" className="mx-auto w-[min(1180px,calc(100%_-_2rem))] py-8 sm:py-10">
        <header className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between" aria-labelledby="review-title">
          <div>
            <h1 id="review-title" className="text-2xl font-semibold tracking-tight">{reviewTitle(search)}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{search.view === "decisions" ? "Review agent decisions before they become field guide candidates." : search.view === "queue" ? "Approve, reject, or defer pending field guide candidates." : "Inspect the immutable decision history."}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={search.view === "decisions" && data.decisions?.pending ? "secondary" : "default"}>{summaryLabel(data, search)}</Badge>
            <span className="hidden text-xs text-muted-foreground md:inline">{data.actor}</span>
            <Button variant="ghost" size="sm" render={<a href="/cdn-cgi/access/logout" />}>Sign out</Button>
          </div>
        </header>
        <div className="mb-5"><ReviewNav search={search} /></div>
        {notice ? <Alert className="mb-4" variant={notice.tone === "error" ? "destructive" : "default"} data-tone={notice.tone}>{notice.text}</Alert> : null}
        {search.view === "decisions" ? <DecisionWorkspace data={{ ...data, decisions: data.decisions! }} search={search} setData={setData} setNotice={setNotice} onLoadMore={() => void loadMore()} /> : null}
        {search.view === "queue" ? <QueueWorkspace data={{ ...data, queue: data.queue! }} search={search} setData={setData} setNotice={setNotice} /> : null}
        {search.view === "history" ? <HistoryWorkspace data={data} search={search} onLoadMore={() => void loadMore()} setNotice={setNotice} /> : null}
      </main>
    </>
  );
}

function ReviewNav({ search }: { search: ReviewSearch }) {
  return <Tabs value={search.view}><TabsList>{(["decisions", "queue", "history"] as const).map((view) => <TabsTrigger key={view} value={view} render={<Link to="/review" search={{ ...search, view }} />}>{view === "decisions" ? "Decisions" : view === "queue" ? "Candidates" : "History"}</TabsTrigger>)}</TabsList></Tabs>;
}

function DecisionWorkspace({ data, search, setData, setNotice, onLoadMore }: { data: DecisionsPageData; search: ReviewSearch; setData: (data: ReviewPageData) => void; setNotice: (notice: { text: string; tone: "success" | "error" }) => void; onLoadMore: () => void }) {
  const [selectedId, setSelectedId] = useState(data.decisions.items[0]?.record.decisionRecordId);
  const [sheetOpen, setSheetOpen] = useState(false);
  const selected = data.decisions.items.find((item) => item.record.decisionRecordId === selectedId) ?? data.decisions.items[0];

  function updateItem(updated: DecisionRecordItem) {
    const reviewedId = updated.record.decisionRecordId;
    if (search.reviewState === "unreviewed" && updated.currentFeedback) {
      const decisions = reconcileReviewedDecision(data.decisions, reviewedId);
      setData({ ...data, decisions });
      setSelectedId(decisions.items[0]?.record.decisionRecordId);
      setSheetOpen(false);
      return;
    }
    setData({ ...data, decisions: { ...data.decisions, items: data.decisions.items.map((item) => item.record.decisionRecordId === reviewedId ? updated : item) } });
  }

  function selectItem(item: DecisionRecordItem, openSheet = false) {
    setSelectedId(item.record.decisionRecordId);
    if (openSheet) setSheetOpen(true);
  }

  return <>
    <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <ReviewScopeTabs search={search} />
        <Tabs value={search.reviewState}><TabsList>{(["unreviewed", "reviewed", "all"] as const).map((reviewState) => <TabsTrigger key={reviewState} value={reviewState} render={<Link to="/review" search={{ ...search, reviewState }} />}>{reviewState === "all" ? "All" : reviewState === "reviewed" ? "Reviewed" : "Unreviewed"}</TabsTrigger>)}</TabsList></Tabs>
      </div>
      <DecisionFilters search={search} />
    </div>
    {!data.decisions.items.length ? <Empty title={`No ${search.reviewState} decisions`} body={search.reviewState === "unreviewed" ? "Every uploaded decision has been reviewed." : "Decision records will appear here."} /> : <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,.75fr)]">
      <Card className="gap-0 py-0" aria-labelledby="decision-list-title">
        <CardHeader className="border-b py-4">
          <CardTitle id="decision-list-title">Decision records</CardTitle>
          <CardDescription>{data.decisions.pending} unresolved · newest first</CardDescription>
        </CardHeader>
        <Table>
          <TableHeader><TableRow><TableHead>Decision</TableHead><TableHead className="hidden md:table-cell">Project</TableHead><TableHead className="hidden lg:table-cell">Confidence</TableHead><TableHead>State</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
          <TableBody>{data.decisions.items.map((item) => {
            const record = item.record;
            const selectedRow = record.decisionRecordId === selected?.record.decisionRecordId;
            return <TableRow key={record.decisionRecordId} data-state={selectedRow ? "selected" : undefined}>
              <TableCell className="min-w-52 max-w-md whitespace-normal"><Button type="button" variant="link" className="h-auto max-w-full justify-start px-0 text-left font-medium whitespace-normal" onClick={() => selectItem(item)}>{record.summary}</Button><span className="mt-1 block truncate font-mono text-[0.68rem] text-muted-foreground">{formatDate(record.createdAt)} · {record.decisionRecordId}</span></TableCell>
              <TableCell className="hidden md:table-cell"><Badge variant="outline">{decisionProject(record)}</Badge></TableCell>
              <TableCell className="hidden font-mono text-xs text-muted-foreground lg:table-cell">{record.confidence}</TableCell>
              <TableCell><Badge variant={item.currentFeedback ? item.currentFeedback.action === "down" ? "destructive" : "outline" : "secondary"}>{item.currentFeedback ? feedbackLabel(item.currentFeedback.action) : "Unreviewed"}</Badge></TableCell>
              <TableCell className="text-right"><Button type="button" variant="ghost" size="sm" className="xl:hidden" onClick={() => selectItem(item, true)}>Review</Button><Button type="button" variant="ghost" size="sm" className="hidden xl:inline-flex" onClick={() => selectItem(item)}>Open</Button></TableCell>
            </TableRow>;
          })}</TableBody>
        </Table>
        {data.decisions.nextCursor ? <div className="flex justify-center border-t p-3"><Button type="button" variant="ghost" size="sm" onClick={onLoadMore}>Load older decisions</Button></div> : null}
      </Card>
      {selected ? <div className="hidden xl:block"><DecisionReviewPanel key={selected.record.decisionRecordId} item={selected} onNotice={setNotice} onUpdated={updateItem} /></div> : null}
    </div>}
    <Sheet open={sheetOpen} onOpenChange={setSheetOpen}><SheetContent className="w-full gap-0 overflow-hidden p-0 sm:max-w-xl" side="right">{selected ? <><SheetHeader className="sr-only"><SheetTitle>{selected.record.summary}</SheetTitle><SheetDescription>{decisionProject(selected.record)} · {selected.record.confidence} confidence · {formatDate(selected.record.createdAt)}</SheetDescription></SheetHeader><ScrollArea className="min-h-0 flex-1"><div className="p-4"><DecisionReviewPanel key={selected.record.decisionRecordId} item={selected} onNotice={setNotice} onUpdated={updateItem} embedded /></div></ScrollArea></> : null}</SheetContent></Sheet>
  </>;
}

export function reconcileReviewedDecision(
  decisions: NonNullable<ReviewPageData["decisions"]>,
  reviewedId: string
) {
  const removed = decisions.items.some((item) => item.record.decisionRecordId === reviewedId);
  return {
    ...decisions,
    pending: removed ? Math.max(0, decisions.pending - 1) : decisions.pending,
    items: decisions.items.filter((item) => item.record.decisionRecordId !== reviewedId)
  };
}

function ReviewScopeTabs({ search }: { search: ReviewSearch }) {
  return <Tabs value={search.scope}><TabsList><TabsTrigger value="project" render={<Link to="/review" search={{ ...search, scope: "project" }} />}>Project</TabsTrigger><TabsTrigger value="global" render={<Link to="/review" search={{ ...search, scope: "global" }} />}>Global</TabsTrigger></TabsList></Tabs>;
}

function DecisionFilters({ search }: { search: ReviewSearch }) {
  const navigate = useNavigate({ from: "/review" });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next: ReviewSearch = { ...search };
    for (const key of ["projectKey", "taskId", "device", "harness", "skill", "from", "to"] as const) {
      const value = String(form.get(key) ?? "").trim();
      if (value) next[key] = value; else delete next[key];
    }
    void navigate({ search: next });
  }
  const filterCount = (["projectKey", "taskId", "device", "harness", "skill", "from", "to"] as const).filter((key) => search[key]).length;
  return <Popover><PopoverTrigger render={<Button variant="outline" size="sm" />}><FilterIcon />Filters{filterCount ? <Badge variant="secondary">{filterCount}</Badge> : null}</PopoverTrigger><PopoverContent align="end" className="w-[min(28rem,calc(100vw_-_2rem))]"><PopoverHeader><PopoverTitle>Filter decisions</PopoverTitle><PopoverDescription>Filters are stored in the URL and apply to all matching decision records.</PopoverDescription></PopoverHeader><form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={submit} aria-label="Decision filters"><Label className="sm:col-span-2">Project<Input name="projectKey" defaultValue={search.projectKey ?? ""} placeholder="Project key" /></Label><Label>Task<Input name="taskId" defaultValue={search.taskId ?? ""} placeholder="Task ID" /></Label><Label>Device<Input name="device" defaultValue={search.device ?? ""} placeholder="Device" /></Label><Label>Harness<Input name="harness" defaultValue={search.harness ?? ""} placeholder="Harness" /></Label><Label>Skill<Input name="skill" defaultValue={search.skill ?? ""} placeholder="Skill" /></Label><Label>From<Input name="from" type="date" defaultValue={search.from ?? ""} /></Label><Label>To<Input name="to" type="date" defaultValue={search.to ?? ""} /></Label><div className="flex justify-end gap-2 pt-1 sm:col-span-2"><Button variant="ghost" size="sm" render={<Link to="/review" search={{ scope: search.scope, view: search.view, reviewState: search.reviewState }} />}>Clear</Button><Button type="submit" size="sm">Apply filters</Button></div></form></PopoverContent></Popover>;
}

function DecisionReviewPanel({ item, onNotice, onUpdated, embedded = false }: { item: DecisionRecordItem; onNotice: (notice: { text: string; tone: "success" | "error" }) => void; onUpdated: (item: DecisionRecordItem) => void; embedded?: boolean }) {
  const feedback = item.currentFeedback;
  const [comment, setComment] = useState(item.currentFeedback?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const [promotionOpen, setPromotionOpen] = useState(false);
  const [promotionBusy, setPromotionBusy] = useState(false);
  const record = item.record;

  async function giveFeedback(action: "up" | "down" | "dismiss") {
    setBusy(true);
    try {
      const response = await fetch(`/api/review/decision-records/${record.decisionRecordId}/feedback`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...(comment.trim() ? { comment: comment.trim() } : {}), ...(feedback ? { expectedFeedbackId: feedback.feedbackId } : {}) }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.message === "string" ? payload.message : `Feedback failed (HTTP ${response.status}).`);
      const next = payload.feedback as DecisionFeedback;
      onUpdated({ ...item, currentFeedback: next, feedbackHistory: [...item.feedbackHistory, next] }); onNotice({ text: "Feedback saved.", tone: "success" });
    } catch (error) { onNotice({ text: error instanceof Error ? error.message : "Feedback could not be saved.", tone: "error" }); }
    finally { setBusy(false); }
  }

  async function promote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPromotionBusy(true);
    const form = new FormData(event.currentTarget);
    const project = record.scope === "project" ? { projectKey: record.foundProjectKey ?? record.projectKey ?? "", projectDisplayName: record.foundProjectDisplayName ?? record.projectDisplayName ?? "" } : {};
    const candidate = { candidateId: crypto.randomUUID(), scope: record.scope, ...project, ...(record.foundProjectKey ? { foundProjectKey: record.foundProjectKey, foundProjectDisplayName: record.foundProjectDisplayName } : {}), lessonKey: String(form.get("lessonKey") ?? ""), title: String(form.get("title") ?? ""), body: String(form.get("body") ?? ""), rationale: String(form.get("rationale") ?? ""), evidence: record.evidence.map((evidence) => ({ excerpt: evidence.excerpt, commitHashes: evidence.commitHashes })), createdAt: record.createdAt };
    try {
      const response = await fetch("/api/review/decision-records/promotions", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), decisionRecordIds: [record.decisionRecordId], candidate }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.message === "string" ? payload.message : `Promotion failed (HTTP ${response.status}).`);
      setPromotionOpen(false); onUpdated({ ...item, promotionCandidateId: payload.promotion?.candidateId }); onNotice({ text: "Candidate drafted from this reviewed decision.", tone: "success" });
    } catch (error) { onNotice({ text: error instanceof Error ? error.message : "Promotion could not be completed.", tone: "error" }); }
    finally { setPromotionBusy(false); }
  }

  const feedbackVariant = feedback ? feedback.action === "down" ? "destructive" : feedback.action === "dismiss" ? "outline" : "default" : "secondary";
  const content = <><CardHeader className={embedded ? "px-0 pt-0" : "border-b"}><CardTitle className="pr-16 text-base leading-snug">{record.summary}</CardTitle><CardDescription>{decisionProject(record)} · {record.confidence} confidence · {formatDate(record.createdAt)}</CardDescription><CardAction><Badge variant={feedbackVariant}>{feedback ? feedbackLabel(feedback.action) : "Unreviewed"}</Badge></CardAction></CardHeader><CardContent className={embedded ? "space-y-5 px-0" : "space-y-5"}><section><p className="text-xs font-medium text-muted-foreground">Choice</p><h3 className="mt-1 text-sm font-medium leading-6">{record.choice}</h3><p className="mt-3 text-sm leading-6 text-muted-foreground">{record.context}</p></section><Separator /><Accordion defaultValue={record.evidence.length ? ["evidence"] : []} multiple><AccordionItem value="evidence"><AccordionTrigger>Evidence <Badge variant="outline">{record.evidence.length}</Badge></AccordionTrigger><AccordionContent className="space-y-2">{record.evidence.length ? record.evidence.map((evidence) => <blockquote className="border-l-2 pl-3 text-sm text-muted-foreground" key={`${record.decisionRecordId}-${evidence.excerpt}`}>{evidence.excerpt}{evidence.commitHashes.length ? <div className="mt-2 font-mono text-[0.68rem] text-muted-foreground">{evidence.commitHashes.join(" · ")}</div> : null}</blockquote>) : <p>No evidence excerpts were attached.</p>}</AccordionContent></AccordionItem></Accordion><Label>Reviewer comment<Textarea className="mt-2" value={comment} onChange={(event) => setComment(event.currentTarget.value)} placeholder="Optional context for this feedback" /></Label><div className="flex flex-wrap gap-2"><ButtonGroup><Button type="button" variant="default" size="sm" disabled={busy} onClick={() => void giveFeedback("up")}>Reasonable here</Button><Button type="button" variant="destructive" size="sm" disabled={busy} onClick={() => void giveFeedback("down")}>Should not repeat</Button></ButtonGroup><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void giveFeedback("dismiss")}>Dismiss</Button>{feedback && !item.promotionCandidateId ? <Button type="button" variant="secondary" size="sm" onClick={() => setPromotionOpen(true)}>Draft candidate</Button> : null}</div>{item.promotionCandidateId ? <Alert variant="default" data-tone="success">Candidate drafted · {item.promotionCandidateId}</Alert> : null}</CardContent></>;
  return <>{embedded ? content : <Card className="sticky top-4">{content}</Card>}<Dialog open={promotionOpen} onOpenChange={setPromotionOpen}><DialogContent><DialogHeader><DialogTitle>Draft a field-guide candidate</DialogTitle><DialogDescription>This creates an inactive candidate. It does not change active guidance.</DialogDescription></DialogHeader><form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={promote}><Label>Lesson key<Input name="lessonKey" defaultValue={slugify(record.summary)} required /></Label><Label>Title<Input name="title" defaultValue={record.summary} required /></Label><Label className="sm:col-span-2">Guidance<Textarea name="body" defaultValue={record.choice} required /></Label><Label className="sm:col-span-2">Rationale<Textarea name="rationale" defaultValue={feedback?.comment ?? record.rationale} required /></Label><div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="ghost" onClick={() => setPromotionOpen(false)}>Cancel</Button><Button type="submit" variant="secondary" disabled={promotionBusy}>{promotionBusy ? "Drafting…" : "Create inactive candidate"}</Button></div></form></DialogContent></Dialog></>;
}

function QueueWorkspace({ data, search, setData, setNotice }: { data: QueuePageData; search: ReviewSearch; setData: (data: ReviewPageData) => void; setNotice: (notice: { text: string; tone: "success" | "error" }) => void }) {
  const items = data.queue.items;
  return <><ReviewScopeTabs search={search} /><div className="review-list">{items.length === 0 ? <Empty title="Nothing to review" body="Every candidate in this scope has been handled." /> : items.map((item) => <QueueCard key={`${item.candidate.candidateId}-${item.round}`} item={item} onComplete={() => setData({ ...data, queue: { ...data.queue, items: data.queue.items.filter((candidate) => candidate !== item) } })} onNotice={setNotice} />)}</div></>;
}

function QueueCard({ item, onComplete, onNotice }: { item: QueueItem; onComplete: () => void; onNotice: (notice: { text: string; tone: "success" | "error" }) => void }) {
  const [busy, setBusy] = useState(false);
  const [deferOpen, setDeferOpen] = useState(false);
  const [deferUntil, setDeferUntil] = useState("");
  const candidate = item.candidate;
  const actions = item.kind === "initial" ? [{ action: "approve", label: "Approve", variant: "default" as const }, { action: "reject", label: "Reject", variant: "destructive" as const }] : [{ action: "confirm_valid", label: "Still valid", variant: "default" as const }, { action: "mark_invalid", label: "No longer valid", variant: "destructive" as const }];
  async function verdict(action: string, until?: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/review/candidates/${candidate.candidateId}/rounds/${item.round}/verdict`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...(until ? { deferUntil: new Date(until).toISOString() } : {}) }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.message === "string" ? payload.message : `Review action failed (HTTP ${response.status}).`);
      onComplete(); onNotice({ text: "Review action saved.", tone: "success" });
    } catch (error) { onNotice({ text: error instanceof Error ? error.message : "Review action failed.", tone: "error" }); }
    finally { setBusy(false); }
  }
  async function changeScope() {
    const scope: Scope = candidate.scope === "project" ? "global" : "project";
    if (scope === "project" && !candidate.foundProjectKey) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/review/candidates/${candidate.candidateId}/rounds/${item.round}/scope`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope }) });
      if (!response.ok) throw new Error(`Scope update failed (HTTP ${response.status}).`);
      onNotice({ text: "Candidate scope updated.", tone: "success" });
      window.location.reload();
    } catch (error) { onNotice({ text: error instanceof Error ? error.message : "Scope update failed.", tone: "error" }); setBusy(false); }
  }
  return <Card className={`queue-card queue-card--${item.status}`}><div className="queue-card__meta"><span>{candidate.projectDisplayName ?? candidate.projectKey ?? "Global"}</span><span>·</span><span>{item.kind === "initial" ? "New candidate" : "Revalidation"}</span><span>·</span><span>Round {item.round}</span>{item.dueAt ? <><span>·</span><time dateTime={item.dueAt} suppressHydrationWarning>{relativeTime(item.dueAt)}</time></> : null}</div><h2>{candidate.title}</h2><p className="queue-card__body">{candidate.body}</p><div className="queue-card__rationale"><span className="eyebrow">Why remember this</span><p>{candidate.rationale}</p></div><div className="review-evidence">{candidate.evidence.map((evidence) => <blockquote key={evidence.excerpt}>{evidence.excerpt}<div className="app-mono">{evidence.commitHashes.join(" · ")}</div></blockquote>)}</div><div className="queue-card__footer"><div>{actions.map(({ action, label, variant }) => <Button key={action} type="button" variant={variant} size="sm" disabled={busy} onClick={() => void verdict(action)}>{label}</Button>)}<Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setDeferOpen((open) => !open)}>Defer</Button></div>{item.kind === "initial" ? <Button type="button" variant="ghost" size="sm" disabled={busy || (candidate.scope === "global" && !candidate.foundProjectKey)} onClick={() => void changeScope()}>{candidate.scope === "project" ? "Promote to global" : "Demote to project"}</Button> : null}</div>{deferOpen ? <div className="review-actions"><Label>Review again after<Input type="datetime-local" value={deferUntil} onChange={(event) => setDeferUntil(event.currentTarget.value)} /></Label><Button type="button" variant="secondary" size="sm" disabled={!deferUntil || busy} onClick={() => void verdict("defer", deferUntil)}>Confirm defer</Button></div> : null}</Card>;
}

function HistoryWorkspace({ data, search, onLoadMore, setNotice }: { data: ReviewPageData; search: ReviewSearch; onLoadMore: () => void; setNotice: (notice: { text: string; tone: "success" | "error" }) => void }) {
  return <><ReviewScopeTabs search={search} /><div className="review-list">{!data.history?.decisions.length ? <Empty title="No decisions yet" body="Reviewed lessons will appear here as an immutable ledger." /> : data.history.decisions.map((decision) => <HistoryCard key={decision.decisionId} decision={decision} onNotice={setNotice} />)}{data.history?.nextCursor ? <div className="review-actions"><Button type="button" variant="ghost" onClick={onLoadMore}>Load older history</Button></div> : null}</div></>;
}

function HistoryCard({ decision, onNotice }: { decision: Decision; onNotice: (notice: { text: string; tone: "success" | "error" }) => void }) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState(decision.roundKind === "initial" ? "approve" : "confirm_valid");
  const [deferUntil, setDeferUntil] = useState("");
  const [busy, setBusy] = useState(false);
  async function amend() {
    setBusy(true);
    try {
      const response = await fetch(`/api/review/candidates/${decision.candidateId}/rounds/${decision.round}/amendments`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, expectedDecisionId: decision.decisionId, ...(action === "defer" && deferUntil ? { deferUntil: new Date(deferUntil).toISOString() } : {}) }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.message === "string" ? payload.message : `Amendment failed (HTTP ${response.status}).`);
      onNotice({ text: "Decision amendment saved.", tone: "success" }); window.location.reload();
    } catch (error) { onNotice({ text: error instanceof Error ? error.message : "Amendment failed.", tone: "error" }); setBusy(false); }
  }
  return <Card className={`history-row${decision.isCurrent ? "" : " history-row--superseded"}`}><div className="queue-card__meta"><span>{decision.projectDisplayName ?? decision.projectKey ?? "Global"}</span><span>·</span><span>{humanAction(decision.action)}</span><span>·</span><span>{decision.isCurrent ? "Current decision" : "Superseded"}</span><span>·</span><time dateTime={decision.reviewedAt} suppressHydrationWarning>{relativeTime(decision.reviewedAt)}</time></div><h2>{decision.title}</h2><p className="app-muted">Round {decision.round} · lesson {decision.effect === "activate" ? "active" : "archived"} · reviewed by {decision.reviewer}</p><div className="review-evidence">{decision.evidence.map((evidence) => <blockquote key={evidence.excerpt}>{evidence.excerpt}</blockquote>)}</div>{decision.canAmend ? <><div className="review-actions"><Button type="button" variant="ghost" size="sm" onClick={() => setOpen((value) => !value)}>Update decision</Button></div>{open ? <div className="review-actions"><AppSelect value={action} onValueChange={setAction} options={[{ value: decision.roundKind === "initial" ? "approve" : "confirm_valid", label: decision.roundKind === "initial" ? "Approve" : "Still valid" }, { value: decision.roundKind === "initial" ? "reject" : "mark_invalid", label: decision.roundKind === "initial" ? "Reject" : "No longer valid" }, { value: "defer", label: "Defer" }]} />{action === "defer" ? <Input type="datetime-local" value={deferUntil} onChange={(event) => setDeferUntil(event.currentTarget.value)} /> : null}<Button type="button" variant="secondary" size="sm" disabled={busy || (action === "defer" && !deferUntil)} onClick={() => void amend()}>Save amendment</Button></div> : null}</> : null}</Card>;
}

function Empty({ title, body }: { title: string; body: string }) { return <EmptyRoot className="border"><EmptyHeader><EmptyMedia variant="icon"><InboxIcon /></EmptyMedia><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{body}</EmptyDescription></EmptyHeader></EmptyRoot>; }

function reviewTitle(search: ReviewSearch) { return search.view === "decisions" ? "Decision inbox" : search.view === "queue" ? "Pending candidates" : "Decision history"; }
function summaryLabel(data: ReviewPageData, search: ReviewSearch) { if (search.view === "decisions") return `${data.decisions?.pending ?? 0} unresolved`; if (search.view === "queue") return `${data.queue?.summary.pending ?? 0} pending`; return `${data.history?.decisions.length ?? 0} loaded`; }
function decisionProject(record: DecisionRecordItem["record"]) { return record.foundProjectDisplayName ?? record.foundProjectKey ?? record.projectDisplayName ?? record.projectKey ?? "Global"; }
function feedbackLabel(action: DecisionFeedback["action"]) { return action === "up" ? "Reasonable here" : action === "down" ? "Should not repeat" : "Dismissed"; }
function humanAction(action: Decision["action"]) { return action === "approve" ? "Approved" : action === "reject" ? "Rejected" : action === "defer" ? "Deferred" : action === "confirm_valid" ? "Confirmed valid" : "Marked invalid"; }
function relativeTime(value: string) { const time = new Date(value).getTime(); if (!Number.isFinite(time)) return value; const minutes = Math.round((time - Date.now()) / 60_000); const absolute = Math.abs(minutes); const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" }); if (absolute < 60) return formatter.format(minutes, "minute"); const hours = Math.round(minutes / 60); if (Math.abs(hours) < 24) return formatter.format(hours, "hour"); return formatter.format(Math.round(hours / 24), "day"); }
function formatDate(value: string) { return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value)); }
function slugify(value: string) { return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "field-guide-lesson"; }
function addSearchFilters(params: URLSearchParams, search: ReviewSearch) { for (const key of ["projectKey", "taskId", "device", "harness", "skill", "from", "to"] as const) if (search[key]) params.set(key, search[key]!); }

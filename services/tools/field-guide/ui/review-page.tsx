import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { InboxIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";
import type {
  Candidate,
  Decision,
  DecisionFeedback,
  DecisionRecordItem,
  DecisionReviewState,
  QueueItem,
  Scope
} from "@tools-platform/field-guide";
import { AppShell } from "../../src/components/app-shell.js";
import { AppSelect } from "../../src/components/form-controls.js";
import { Alert } from "../../src/components/ui/alert.js";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../../src/components/ui/accordion.js";
import { Badge } from "../../src/components/ui/badge.js";
import { Button } from "../../src/components/ui/button.js";
import { ButtonGroup } from "../../src/components/ui/button-group.js";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "../../src/components/ui/card.js";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../src/components/ui/dialog.js";
import { Empty as EmptyRoot, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../../src/components/ui/empty.js";
import { Input } from "../../src/components/ui/input.js";
import { Label } from "../../src/components/ui/label.js";
import { Popover, PopoverContent, PopoverTrigger } from "../../src/components/ui/popover.js";
import { Separator } from "../../src/components/ui/separator.js";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../src/components/ui/sheet.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../src/components/ui/table.js";
import { Tabs, TabsList, TabsTrigger } from "../../src/components/ui/tabs.js";
import { Textarea } from "../../src/components/ui/textarea.js";
import { useIsMobile } from "../../src/components/ui/use-mobile.js";
import type { ReviewPageData, ReviewView } from "../../src/protected-data.js";

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
  queueProject?: string;
  queueKind?: "all" | "initial" | "scheduled";
  queueStatus?: "all" | "pending" | "due" | "overdue";
  queueQuery?: string;
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
      <AppShell product="Field Guide" showSignOut />
      <main id="main" className="mx-auto w-[min(1180px,calc(100%_-_2rem))] py-8 sm:py-10">
        <header className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between" aria-labelledby="review-title">
          <div>
            <h1 id="review-title" className="text-2xl font-semibold tracking-tight">{reviewTitle(search)}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{search.view === "decisions" ? "Review agent decisions before they become field guide candidates." : search.view === "queue" ? "Approve, reject, or defer pending field guide candidates." : "Inspect the immutable decision history."}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={search.view === "decisions" && data.decisions?.pending ? "secondary" : "default"}>{summaryLabel(data, search)}</Badge>
            <ActorIdentity actor={data.actor} />
          </div>
        </header>
        <div className="mb-5"><ReviewNav search={search} /></div>
        {notice ? <Alert className="mb-4" variant={notice.tone === "error" ? "destructive" : "default"} data-tone={notice.tone}>{notice.text}</Alert> : null}
        {search.view === "decisions" && data.view === "decisions" && data.decisions ? <DecisionWorkspace data={{ ...data, decisions: data.decisions }} search={search} setData={setData} setNotice={setNotice} onLoadMore={() => void loadMore()} /> : null}
        {search.view === "queue" && data.view === "queue" && data.queue ? <QueueWorkspace data={{ ...data, queue: data.queue }} search={search} setData={setData} setNotice={setNotice} /> : null}
        {search.view === "history" && data.view === "history" && data.history ? <HistoryWorkspace data={data} search={search} onLoadMore={() => void loadMore()} setNotice={setNotice} /> : null}
      </main>
    </>
  );
}

function ReviewNav({ search }: { search: ReviewSearch }) {
  return <Tabs value={search.view}><TabsList>{(["decisions", "queue", "history"] as const).map((view) => <TabsTrigger key={view} value={view} render={<Link to="/field-guide" search={{ ...search, view }} preload="intent" />}>{view === "decisions" ? "Decisions" : view === "queue" ? "Candidates" : "History"}</TabsTrigger>)}</TabsList></Tabs>;
}

function DecisionWorkspace({ data, search, setData, setNotice, onLoadMore }: { data: DecisionsPageData; search: ReviewSearch; setData: (data: ReviewPageData) => void; setNotice: (notice: { text: string; tone: "success" | "error" }) => void; onLoadMore: () => void }) {
  const [selectedId, setSelectedId] = useState(data.decisions.items[0]?.record.decisionRecordId);
  const selected = data.decisions.items.find((item) => item.record.decisionRecordId === selectedId) ?? data.decisions.items[0];
  const emptyState = decisionEmptyState(data.decisions, search.reviewState);

  function updateItem(updated: DecisionRecordItem) {
    const reviewedId = updated.record.decisionRecordId;
    if (search.reviewState === "unreviewed" && updated.currentFeedback) {
      const decisions = reconcileReviewedDecision(data.decisions, reviewedId);
      setData({ ...data, decisions });
      setSelectedId(decisions.items[0]?.record.decisionRecordId);
      return;
    }
    setData({ ...data, decisions: { ...data.decisions, items: data.decisions.items.map((item) => item.record.decisionRecordId === reviewedId ? updated : item) } });
  }

  function selectItem(item: DecisionRecordItem) {
    setSelectedId(item.record.decisionRecordId);
  }

  return <>
    <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <ReviewScopeTabs search={search} />
        <Tabs value={search.reviewState}><TabsList>{(["unreviewed", "reviewed", "all"] as const).map((reviewState) => <TabsTrigger key={reviewState} value={reviewState} render={<Link to="/field-guide" search={{ ...search, reviewState }} preload="intent" />}>{reviewState === "all" ? "All" : reviewState === "reviewed" ? "Reviewed" : "Unreviewed"}</TabsTrigger>)}</TabsList></Tabs>
      </div>
      <DecisionFilters search={search} />
    </div>
    {!data.decisions.items.length ? <Empty title={emptyState.title} body={emptyState.body} action={emptyState.canLoadMore ? <Button type="button" variant="outline" size="sm" onClick={onLoadMore}>Load next page</Button> : undefined} /> : <div className="flex flex-col gap-6">
      {selected ? <section className="mx-auto w-full max-w-3xl" aria-label="Current review task"><DecisionReviewPanel key={selected.record.decisionRecordId} item={selected} onNotice={setNotice} onUpdated={updateItem} /></section> : null}
      <Card className="gap-0 py-0" aria-labelledby="decision-list-title">
        <CardHeader className="border-b py-4">
          <CardTitle id="decision-list-title">Up next</CardTitle>
          <CardDescription>{data.decisions.pending} unresolved · select another decision to review</CardDescription>
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
              <TableCell className="text-right"><Button type="button" variant="ghost" size="sm" onClick={() => selectItem(item)}>Review</Button></TableCell>
            </TableRow>;
          })}</TableBody>
        </Table>
        {data.decisions.nextCursor ? <div className="flex justify-center border-t p-3"><Button type="button" variant="ghost" size="sm" onClick={onLoadMore}>Load older decisions</Button></div> : null}
      </Card>
    </div>}
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

export function decisionEmptyState(
  decisions: NonNullable<ReviewPageData["decisions"]>,
  reviewState: DecisionReviewState
) {
  const canLoadMore = Boolean(decisions.nextCursor);
  return {
    canLoadMore,
    title: canLoadMore ? "No decisions on this page" : `No ${reviewState} decisions`,
    body: canLoadMore
      ? "More matching decisions are available on the next page."
      : reviewState === "unreviewed"
        ? "Every uploaded decision has been reviewed."
        : "Decision records will appear here."
  };
}

function ReviewScopeTabs({ search }: { search: ReviewSearch }) {
  return <Tabs value={search.scope}><TabsList><TabsTrigger value="project" render={<Link to="/field-guide" search={{ ...search, scope: "project" }} preload="intent" />}>Project</TabsTrigger><TabsTrigger value="global" render={<Link to="/field-guide" search={{ ...search, scope: "global" }} preload="intent" />}>Global</TabsTrigger></TabsList></Tabs>;
}

function DecisionFilters({ search }: { search: ReviewSearch }) {
  const facets = [
    ["taskId", "Task", "Task ID", "text"], ["device", "Device", "Device", "text"], ["harness", "Harness", "Harness", "text"],
    ["skill", "Skill", "Skill", "text"], ["from", "From", "Start date", "date"], ["to", "To", "End date", "date"]
  ] as const;
  const [visible, setVisible] = useState(() => new Set(facets.filter(([key]) => search[key]).map(([key]) => key)));
  function update(key: keyof ReviewSearch, value?: string) {
    const next = { ...search };
    if (value?.trim()) Object.assign(next, { [key]: value.trim() }); else delete next[key];
    replaceReviewDocument(next);
  }
  function remove(key: typeof facets[number][0]) { setVisible((current) => { const next = new Set(current); next.delete(key); return next; }); update(key); }
  const activeCount = [search.projectKey, ...facets.map(([key]) => search[key])].filter(Boolean).length;
  return <div className="data-filter" aria-label="Decision filters">
    <div className="data-filter__bar">
      <Label className="data-filter__search"><span className="sr-only">Filter decisions by project</span><SearchIcon aria-hidden="true" /><DebouncedFilterInput value={search.projectKey ?? ""} onCommit={(value) => update("projectKey", value)} placeholder="Filter decisions by project" /></Label>
      <Popover><PopoverTrigger render={<Button type="button" variant="outline" size="sm" />}><PlusIcon />Add filter</PopoverTrigger><PopoverContent align="end" className="w-48 gap-1 p-1">{facets.filter(([key]) => !visible.has(key)).map(([key, label]) => <Button key={key} type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => setVisible((current) => new Set(current).add(key))}>{label}</Button>)}</PopoverContent></Popover>
      {activeCount ? <Button type="button" variant="ghost" size="sm" onClick={() => { setVisible(new Set()); replaceReviewDocument({ scope: search.scope, view: search.view, reviewState: search.reviewState }); }}>Reset</Button> : null}
    </div>
    {visible.size ? <div className="data-filter__chips">{facets.filter(([key]) => visible.has(key)).map(([key, label, placeholder, type]) => <div className="data-filter__chip" key={key}><span>{label}</span><DebouncedFilterInput type={type} value={search[key] ?? ""} onCommit={(value) => update(key, value)} placeholder={placeholder} /><Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${label} filter`} onClick={() => remove(key)}><XIcon /></Button></div>)}</div> : null}
  </div>;
}

function DecisionReviewPanel({ item, onNotice, onUpdated }: { item: DecisionRecordItem; onNotice: (notice: { text: string; tone: "success" | "error" }) => void; onUpdated: (item: DecisionRecordItem) => void }) {
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
  const content = <><CardHeader className="border-b"><CardTitle className="pr-16 text-base leading-snug">{record.summary}</CardTitle><CardDescription>{decisionProject(record)} · {record.confidence} confidence · {formatDate(record.createdAt)}</CardDescription><CardAction><Badge variant={feedbackVariant}>{feedback ? feedbackLabel(feedback.action) : "Unreviewed"}</Badge></CardAction></CardHeader><CardContent className="space-y-5"><section><p className="text-xs font-medium text-muted-foreground">Choice</p><h3 className="mt-1 text-sm font-medium leading-6">{record.choice}</h3><p className="mt-3 text-sm leading-6 text-muted-foreground">{record.context}</p></section><Separator /><Accordion defaultValue={record.evidence.length ? ["evidence"] : []} multiple><AccordionItem value="evidence"><AccordionTrigger>Evidence <Badge variant="outline">{record.evidence.length}</Badge></AccordionTrigger><AccordionContent className="space-y-2">{record.evidence.length ? record.evidence.map((evidence) => <blockquote className="border-l-2 pl-3 text-sm text-muted-foreground" key={`${record.decisionRecordId}-${evidence.excerpt}`}>{evidence.excerpt}{evidence.commitHashes.length ? <div className="mt-2 font-mono text-[0.68rem] text-muted-foreground">{evidence.commitHashes.join(" · ")}</div> : null}</blockquote>) : <p>No evidence excerpts were attached.</p>}</AccordionContent></AccordionItem></Accordion><Label>Reviewer comment<Textarea className="mt-2" value={comment} onChange={(event) => setComment(event.currentTarget.value)} placeholder="Optional context for this feedback" /></Label><div className="flex flex-wrap gap-2"><ButtonGroup><Button type="button" variant="default" size="sm" disabled={busy} onClick={() => void giveFeedback("up")}>Reasonable here</Button><Button type="button" variant="destructive" size="sm" disabled={busy} onClick={() => void giveFeedback("down")}>Should not repeat</Button></ButtonGroup><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void giveFeedback("dismiss")}>Dismiss</Button>{feedback && !item.promotionCandidateId ? <Button type="button" variant="secondary" size="sm" onClick={() => setPromotionOpen(true)}>Draft candidate</Button> : null}</div>{item.promotionCandidateId ? <Alert variant="default" data-tone="success">Candidate drafted · {item.promotionCandidateId}</Alert> : null}</CardContent></>;
  return <><Card>{content}</Card><Dialog open={promotionOpen} onOpenChange={setPromotionOpen}><DialogContent><DialogHeader><DialogTitle>Draft a field-guide candidate</DialogTitle><DialogDescription>This creates an inactive candidate. It does not change active guidance.</DialogDescription></DialogHeader><form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={promote}><Label>Lesson key<Input name="lessonKey" defaultValue={slugify(record.summary)} required /></Label><Label>Title<Input name="title" defaultValue={record.summary} required /></Label><Label className="sm:col-span-2">Guidance<Textarea name="body" defaultValue={record.choice} required /></Label><Label className="sm:col-span-2">Rationale<Textarea name="rationale" defaultValue={feedback?.comment ?? record.rationale} required /></Label><div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="ghost" onClick={() => setPromotionOpen(false)}>Cancel</Button><Button type="submit" variant="secondary" disabled={promotionBusy}>{promotionBusy ? "Drafting…" : "Create inactive candidate"}</Button></div></form></DialogContent></Dialog></>;
}

function QueueWorkspace({ data, search, setData, setNotice }: { data: QueuePageData; search: ReviewSearch; setData: (data: ReviewPageData) => void; setNotice: (notice: { text: string; tone: "success" | "error" }) => void }) {
  const items = filterQueueItems(data.queue.items, search);
  const [selectedId, setSelectedId] = useState(items[0]?.candidate.candidateId);
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const isMobile = useIsMobile();
  const selected = items.find((item) => item.candidate.candidateId === selectedId) ?? items[0];
  const projects = queueProjectOptions(data.queue.items);
  const visibleProjectCount = queueProjectOptions(items).length;

  function select(item: QueueItem) {
    setSelectedId(item.candidate.candidateId);
    if (isMobile) setMobileInspectorOpen(true);
  }

  function complete(item: QueueItem) {
    const queue = reconcileCompletedCandidate(data.queue, item);
    const remaining = queue.items;
    setData({ ...data, queue });
    setSelectedId(filterQueueItems(remaining, search)[0]?.candidate.candidateId);
    setMobileInspectorOpen(false);
  }

  const inspector = selected ? <QueueInspector item={selected} onComplete={() => complete(selected)} onNotice={setNotice} /> : null;
  return <>
    <div className="candidate-toolbar">
      <ReviewScopeTabs search={search} />
      <QueueFilters search={search} projects={projects} />
    </div>
    {data.queue.items.length === 0 ? <Empty title="Nothing to review" body="Every candidate in this scope has been handled." /> : items.length === 0 ? <Empty title="No matching candidates" body="Clear or change the filters to see another part of the queue." action={<Button nativeButton={false} variant="outline" size="sm" render={<Link to="/field-guide" search={{ scope: search.scope, view: "queue", reviewState: search.reviewState }} preload="intent" />}>Clear filters</Button>} /> : <div className="candidate-workbench">
      <Card className="candidate-table-card gap-0 py-0">
        <div className="candidate-table-summary"><div><strong>{items.length}</strong> candidate{items.length === 1 ? "" : "s"}</div><span>{visibleProjectCount} project{visibleProjectCount === 1 ? "" : "s"} in queue</span></div>
        <Table>
          <TableHeader><TableRow><TableHead>Candidate</TableHead><TableHead className="hidden xl:table-cell">Project</TableHead><TableHead className="hidden 2xl:table-cell">Kind</TableHead><TableHead>Status</TableHead><TableHead className="w-20"><span className="sr-only">Open</span></TableHead></TableRow></TableHeader>
          <TableBody>{items.map((item) => {
            const active = item.candidate.candidateId === selected?.candidate.candidateId;
            return <TableRow key={`${item.candidate.candidateId}-${item.round}`} data-state={active ? "selected" : undefined}>
              <TableCell className="min-w-56 max-w-sm whitespace-normal"><Button type="button" variant="link" className="h-auto max-w-full justify-start px-0 text-left font-medium whitespace-normal" onClick={() => select(item)}>{item.candidate.title}</Button><span className="mt-1 block text-xs text-muted-foreground">Round {item.round}{item.dueAt ? ` · ${relativeTime(item.dueAt)}` : ""}</span></TableCell>
              <TableCell className="hidden xl:table-cell"><Badge variant="outline">{queueProject(item)}</Badge></TableCell>
              <TableCell className="hidden text-xs text-muted-foreground 2xl:table-cell">{item.kind === "initial" ? "New" : "Revalidation"}</TableCell>
              <TableCell><Badge variant={item.status === "overdue" ? "destructive" : item.status === "due" ? "secondary" : "outline"}>{item.status}</Badge></TableCell>
              <TableCell className="w-20 text-right"><Button type="button" variant="outline" size="sm" onClick={() => select(item)}>Review</Button></TableCell>
            </TableRow>;
          })}</TableBody>
        </Table>
      </Card>
      {!isMobile ? <aside className="candidate-inspector" aria-label="Selected candidate">{inspector}</aside> : null}
    </div>}
    {isMobile ? <Sheet open={mobileInspectorOpen} onOpenChange={setMobileInspectorOpen}><SheetContent className="w-[min(42rem,100%)] overflow-y-auto sm:max-w-xl"><SheetHeader className="border-b"><SheetTitle>Review candidate</SheetTitle><SheetDescription>Inspect the guidance and record a verdict.</SheetDescription></SheetHeader><div className="p-4 pt-0">{inspector}</div></SheetContent></Sheet> : null}
  </>;
}

function QueueFilters({ search, projects }: { search: ReviewSearch; projects: string[] }) {
  const facets = ["queueProject", "queueKind", "queueStatus"] as const;
  const labels = { queueProject: "Project", queueKind: "Kind", queueStatus: "Due" };
  const [visible, setVisible] = useState(() => new Set(facets.filter((key) => search[key])));
  function update(key: typeof facets[number] | "queueQuery", value?: string) {
    const next: ReviewSearch = { ...search };
    if (value && value !== "all") Object.assign(next, { [key]: value }); else delete next[key];
    replaceReviewDocument(next);
  }
  const count = [search.queueProject, search.queueKind, search.queueStatus, search.queueQuery].filter(Boolean).length;
  const options = {
    queueProject: [{ value: "all", label: "All projects" }, ...projects.map((project) => ({ value: project, label: project }))],
    queueKind: [{ value: "all", label: "All kinds" }, { value: "initial", label: "New candidates" }, { value: "scheduled", label: "Revalidations" }],
    queueStatus: [{ value: "all", label: "Any due state" }, { value: "pending", label: "Pending" }, { value: "due", label: "Due" }, { value: "overdue", label: "Overdue" }]
  };
  return <div className="data-filter" aria-label="Candidate filters">
    <div className="data-filter__bar">
      <Label className="data-filter__search"><span className="sr-only">Search candidates</span><SearchIcon aria-hidden="true" /><DebouncedFilterInput className="pl-9!" value={search.queueQuery ?? ""} onCommit={(value) => update("queueQuery", value)} placeholder="Search candidates" /></Label>
      <Popover><PopoverTrigger render={<Button type="button" variant="outline" size="sm" />}><PlusIcon />Add filter</PopoverTrigger><PopoverContent align="end" className="w-48 gap-1 p-1">{facets.filter((key) => !visible.has(key)).map((key) => <Button key={key} type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => setVisible((current) => new Set(current).add(key))}>{labels[key]}</Button>)}</PopoverContent></Popover>
      {count ? <Button type="button" variant="ghost" size="sm" onClick={() => { setVisible(new Set()); replaceReviewDocument({ scope: search.scope, view: "queue", reviewState: search.reviewState }); }}>Reset</Button> : null}
    </div>
    {visible.size ? <div className="data-filter__chips">{facets.filter((key) => visible.has(key)).map((key) => <div className="data-filter__chip" key={key}><span>{labels[key]}</span><AppSelect value={search[key] ?? "all"} aria-label={labels[key]} onValueChange={(value) => update(key, value)} options={options[key]} /><Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${labels[key]} filter`} onClick={() => { setVisible((current) => { const next = new Set(current); next.delete(key); return next; }); update(key); }}><XIcon /></Button></div>)}</div> : null}
  </div>;
}

function QueueInspector({ item, onComplete, onNotice }: { item: QueueItem; onComplete: () => void; onNotice: (notice: { text: string; tone: "success" | "error" }) => void }) {
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
  return <Card className={`queue-card queue-card--${item.status}`}><div className="queue-card__meta"><Badge variant="outline">{queueProject(item)}</Badge><span>{item.kind === "initial" ? "New candidate" : "Revalidation"}</span><span>Round {item.round}</span>{item.dueAt ? <time dateTime={item.dueAt} suppressHydrationWarning>{relativeTime(item.dueAt)}</time> : null}</div><h2>{candidate.title}</h2><p className="queue-card__body">{candidate.body}</p><div className="queue-card__rationale"><span className="eyebrow">Why remember this</span><p>{candidate.rationale}</p></div>{candidate.evidence.length ? <Accordion multiple><AccordionItem value="evidence"><AccordionTrigger>Evidence <Badge variant="outline">{candidate.evidence.length}</Badge></AccordionTrigger><AccordionContent><div className="review-evidence">{candidate.evidence.map((evidence) => <blockquote key={evidence.excerpt}>{evidence.excerpt}<div className="app-mono">{evidence.commitHashes.join(" · ")}</div></blockquote>)}</div></AccordionContent></AccordionItem></Accordion> : null}<div className="queue-card__footer"><div>{actions.map(({ action, label, variant }) => <Button key={action} type="button" variant={variant} size="sm" disabled={busy} onClick={() => void verdict(action)}>{label}</Button>)}<Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setDeferOpen((open) => !open)}>Defer</Button></div>{item.kind === "initial" ? <Button type="button" variant="ghost" size="sm" disabled={busy || (candidate.scope === "global" && !candidate.foundProjectKey)} onClick={() => void changeScope()}>{candidate.scope === "project" ? "Promote to global" : "Demote to project"}</Button> : null}</div>{deferOpen ? <div className="review-actions"><Label>Review again after<Input type="datetime-local" value={deferUntil} onChange={(event) => setDeferUntil(event.currentTarget.value)} /></Label><Button type="button" variant="secondary" size="sm" disabled={!deferUntil || busy} onClick={() => void verdict("defer", deferUntil)}>Confirm defer</Button></div> : null}</Card>;
}

export function filterQueueItems(items: QueueItem[], search: Pick<ReviewSearch, "queueProject" | "queueKind" | "queueStatus" | "queueQuery">) {
  const queryTokens = search.queueQuery?.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean) ?? [];
  return items.filter((item) => {
    if (search.queueProject && queueProject(item) !== search.queueProject) return false;
    if (search.queueKind && item.kind !== search.queueKind) return false;
    if (search.queueStatus && item.status !== search.queueStatus) return false;
    if (!queryTokens.length) return true;
    const searchable = [item.candidate.title, item.candidate.body, item.candidate.rationale, queueProject(item)].join(" ").toLocaleLowerCase();
    return queryTokens.every((token) => searchable.includes(token));
  });
}

export function queueProjectOptions(items: QueueItem[]) {
  return [...new Set(items.map(queueProject))].sort((left, right) => left.localeCompare(right));
}

export function reconcileCompletedCandidate(queue: QueuePageData["queue"], completed: QueueItem) {
  const removed = queue.items.includes(completed);
  if (!removed) return queue;
  return {
    ...queue,
    items: queue.items.filter((item) => item !== completed),
    summary: {
      ...queue.summary,
      [completed.status]: Math.max(0, queue.summary[completed.status] - 1)
    }
  };
}

function queueProject(item: QueueItem) { return item.candidate.projectDisplayName ?? item.candidate.projectKey ?? "Global"; }

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
  const project = decision.projectDisplayName ?? decision.projectKey ?? "Global";
  const actionVariant = decision.action === "reject" || decision.action === "mark_invalid" ? "destructive" : decision.action === "defer" ? "secondary" : "outline";
  return <Card className={`history-row${decision.isCurrent ? "" : " history-row--superseded"}`}>
    <div className="history-row__main">
      <div className="history-row__heading">
        <div><div className="history-row__eyebrow"><span>{project}</span><span>Round {decision.round}</span></div><h2>{decision.title}</h2></div>
        <div className="history-row__badges"><Badge variant={actionVariant}>{humanAction(decision.action)}</Badge><Badge variant={decision.isCurrent ? "outline" : "secondary"}>{decision.isCurrent ? "Current" : "Superseded"}</Badge></div>
      </div>
      <dl className="history-row__meta"><div><dt>Guide state</dt><dd>{decision.effect === "activate" ? "Active" : "Archived"}</dd></div><div><dt>Reviewed</dt><dd><time dateTime={decision.reviewedAt} suppressHydrationWarning>{relativeTime(decision.reviewedAt)}</time></dd></div><div><dt>Reviewer</dt><dd>{decision.reviewer}</dd></div></dl>
      {decision.evidence.length ? <Accordion><AccordionItem value="evidence"><AccordionTrigger>Evidence <Badge variant="outline">{decision.evidence.length}</Badge></AccordionTrigger><AccordionContent><div className="review-evidence">{decision.evidence.map((evidence) => <blockquote key={evidence.excerpt}>{evidence.excerpt}</blockquote>)}</div></AccordionContent></AccordionItem></Accordion> : <p className="history-row__empty-evidence">No evidence attached</p>}
    </div>
    {decision.canAmend ? <div className="history-row__footer"><Button type="button" variant="outline" size="sm" onClick={() => setOpen((value) => !value)}>{open ? "Cancel update" : "Update decision"}</Button>{open ? <div className="history-row__amendment"><AppSelect value={action} onValueChange={setAction} options={[{ value: decision.roundKind === "initial" ? "approve" : "confirm_valid", label: decision.roundKind === "initial" ? "Approve" : "Still valid" }, { value: decision.roundKind === "initial" ? "reject" : "mark_invalid", label: decision.roundKind === "initial" ? "Reject" : "No longer valid" }, { value: "defer", label: "Defer" }]} />{action === "defer" ? <Input type="datetime-local" value={deferUntil} onChange={(event) => setDeferUntil(event.currentTarget.value)} /> : null}<Button type="button" variant="secondary" size="sm" disabled={busy || (action === "defer" && !deferUntil)} onClick={() => void amend()}>{busy ? "Saving…" : "Save amendment"}</Button></div> : null}</div> : null}
  </Card>;
}

function DebouncedFilterInput({ value, onCommit, ...props }: { value: string; onCommit: (value: string) => void } & Omit<React.ComponentProps<typeof Input>, "value" | "onChange">) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (draft === value) return;
    const timeout = window.setTimeout(() => onCommit(draft), 300);
    return () => window.clearTimeout(timeout);
  }, [draft, onCommit, value]);
  return <Input {...props} value={draft} onChange={(event) => setDraft(event.currentTarget.value)} />;
}

function ActorIdentity({ actor }: { actor: string }) {
  const separator = actor.lastIndexOf("@");
  if (separator < 1) return <span className="hidden text-xs text-muted-foreground md:inline">{actor}</span>;
  return <span className="hidden text-xs text-muted-foreground md:inline"><span>{actor.slice(0, separator)}</span><span>@</span><span>{actor.slice(separator + 1)}</span></span>;
}

function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) { return <EmptyRoot className="border"><EmptyHeader><EmptyMedia variant="icon"><InboxIcon /></EmptyMedia><EmptyTitle>{title}</EmptyTitle><EmptyDescription>{body}</EmptyDescription></EmptyHeader>{action ? <EmptyContent>{action}</EmptyContent> : null}</EmptyRoot>; }

function reviewTitle(search: ReviewSearch) { return search.view === "decisions" ? "Decision inbox" : search.view === "queue" ? "Pending candidates" : "Decision history"; }
function summaryLabel(data: ReviewPageData, search: ReviewSearch) { if (search.view === "decisions") return `${data.decisions?.pending ?? 0} unresolved`; if (search.view === "queue") return `${data.queue ? filterQueueItems(data.queue.items, search).filter((item) => item.status === "pending").length : 0} pending`; return `${data.history?.decisions.length ?? 0} loaded`; }
function decisionProject(record: DecisionRecordItem["record"]) { return record.foundProjectDisplayName ?? record.foundProjectKey ?? record.projectDisplayName ?? record.projectKey ?? "Global"; }
function feedbackLabel(action: DecisionFeedback["action"]) { return action === "up" ? "Reasonable here" : action === "down" ? "Should not repeat" : "Dismissed"; }
function humanAction(action: Decision["action"]) { return action === "approve" ? "Approved" : action === "reject" ? "Rejected" : action === "defer" ? "Deferred" : action === "confirm_valid" ? "Confirmed valid" : "Marked invalid"; }
function relativeTime(value: string) { const time = new Date(value).getTime(); if (!Number.isFinite(time)) return value; const minutes = Math.round((time - Date.now()) / 60_000); const absolute = Math.abs(minutes); const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" }); if (absolute < 60) return formatter.format(minutes, "minute"); const hours = Math.round(minutes / 60); if (Math.abs(hours) < 24) return formatter.format(hours, "hour"); return formatter.format(Math.round(hours / 24), "day"); }
function formatDate(value: string) { return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value)); }
function slugify(value: string) { return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "field-guide-lesson"; }
function replaceReviewDocument(search: ReviewSearch) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) if (value) params.set(key, value);
  window.location.replace(`/field-guide?${params}`);
}
function addSearchFilters(params: URLSearchParams, search: ReviewSearch) { for (const key of ["projectKey", "taskId", "device", "harness", "skill", "from", "to"] as const) if (search[key]) params.set(key, search[key]!); }

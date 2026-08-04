import { useState } from "react";
import type { FormEvent } from "react";
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
import { Badge } from "./ui/badge.js";
import { Button } from "./ui/button.js";
import { Card } from "./ui/card.js";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog.js";
import { Input } from "./ui/input.js";
import { Label } from "./ui/label.js";
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
      <header className="app-subheader">
        <div className="app-page app-subheader__inner">
          <a className="app-subheader__brand" href="/review" aria-label="Field guide reviews home"><span>F</span><div><strong>Field guide</strong><small>Review desk</small></div></a>
          <div className="app-subheader__account"><span>{data.actor}</span><Button variant="ghost" size="sm" render={<a href="/cdn-cgi/access/logout" />}>Sign out</Button></div>
        </div>
        <div className="app-page app-subheader__nav"><ReviewNav search={search} /></div>
      </header>
      <main id="main" className="app-page review-page">
        <section className="app-heading" aria-labelledby="review-title">
          <div><p className="eyebrow">{search.view === "decisions" ? "Agent judgment" : search.scope === "project" ? "Project field guide" : "Global field guide"}</p><h1 id="review-title">{reviewTitle(search)}</h1><p>Access protected review workspace.</p></div>
          <div className="app-heading__actions"><Badge variant={search.view === "decisions" && data.decisions?.pending ? "secondary" : "default"}>{summaryLabel(data, search)}</Badge></div>
        </section>
        {notice ? <Alert variant={notice.tone === "error" ? "destructive" : "default"} data-tone={notice.tone}>{notice.text}</Alert> : null}
        {search.view === "decisions" ? <DecisionWorkspace data={{ ...data, decisions: data.decisions! }} search={search} setData={setData} setNotice={setNotice} onLoadMore={() => void loadMore()} /> : null}
        {search.view === "queue" ? <QueueWorkspace data={{ ...data, queue: data.queue! }} search={search} setData={setData} setNotice={setNotice} /> : null}
        {search.view === "history" ? <HistoryWorkspace data={data} search={search} onLoadMore={() => void loadMore()} setNotice={setNotice} /> : null}
      </main>
    </>
  );
}

function ReviewNav({ search }: { search: ReviewSearch }) {
  return <Tabs value={search.view}><TabsList>{(["decisions", "queue", "history"] as const).map((view) => <TabsTrigger key={view} value={view} render={<a href={reviewHref({ ...search, view })} />}>{view === "decisions" ? "Decision inbox" : view === "queue" ? "Candidates" : "History"}</TabsTrigger>)}</TabsList></Tabs>;
}

function DecisionWorkspace({ data, search, setData, setNotice, onLoadMore }: { data: DecisionsPageData; search: ReviewSearch; setData: (data: ReviewPageData) => void; setNotice: (notice: { text: string; tone: "success" | "error" }) => void; onLoadMore: () => void }) {
  return <>
    <ReviewScopeTabs search={search} />
    <DecisionFilters search={search} />
    <section className="app-card review-list" aria-labelledby="decision-list-title">
      <div className="app-card__header"><div><p className="eyebrow">{data.decisions?.pending ?? 0} unresolved</p><h2 id="decision-list-title">Decision records</h2><p>Immutable agent decisions awaiting human feedback.</p></div><span className="app-mono">Newest first</span></div>
      {!data.decisions.items.length ? <Empty title={`No ${search.reviewState} decisions`} body={search.reviewState === "unreviewed" ? "Every uploaded decision has been reviewed." : "Decision records will appear here."} /> : data.decisions.items.map((item) => <DecisionRecordCard key={item.record.decisionRecordId} item={item} onNotice={setNotice} onUpdated={(updated) => setData({ ...data, decisions: { ...data.decisions, items: data.decisions.items.map((candidate) => candidate.record.decisionRecordId === updated.record.decisionRecordId ? updated : candidate) } })} />)}
      {data.decisions?.nextCursor ? <div className="review-actions"><Button type="button" variant="ghost" onClick={onLoadMore}>Load older decisions</Button></div> : null}
    </section>
  </>;
}

function ReviewScopeTabs({ search }: { search: ReviewSearch }) {
  return <div className="review-scope-tabs"><Tabs value={search.scope}><TabsList><TabsTrigger value="project" render={<a href={reviewHref({ ...search, scope: "project" })} />}>Project</TabsTrigger><TabsTrigger value="global" render={<a href={reviewHref({ ...search, scope: "global" })} />}>Global</TabsTrigger></TabsList></Tabs></div>;
}

function DecisionFilters({ search }: { search: ReviewSearch }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next: ReviewSearch = { ...search };
    for (const key of ["projectKey", "taskId", "device", "harness", "skill", "from", "to"] as const) {
      const value = String(form.get(key) ?? "").trim();
      if (value) next[key] = value; else delete next[key];
    }
    window.location.assign(reviewHref(next));
  }
  return <form className="app-toolbar" onSubmit={submit} aria-label="Decision filters"><Label>Project<Input name="projectKey" defaultValue={search.projectKey ?? ""} placeholder="Project key" /></Label><Label>Task<Input name="taskId" defaultValue={search.taskId ?? ""} placeholder="Task ID" /></Label><Label>Device<Input name="device" defaultValue={search.device ?? ""} placeholder="Device" /></Label><Label>Harness<Input name="harness" defaultValue={search.harness ?? ""} placeholder="Harness" /></Label><Label>Skill<Input name="skill" defaultValue={search.skill ?? ""} placeholder="Skill" /></Label><Label>From<Input name="from" type="date" defaultValue={search.from ?? ""} /></Label><Label>To<Input name="to" type="date" defaultValue={search.to ?? ""} /></Label><div className="app-toolbar__actions"><Button type="submit" variant="default" size="sm">Apply filters</Button><Button variant="ghost" size="sm" render={<a href={reviewHref({ scope: search.scope, view: search.view, reviewState: search.reviewState })} />}>Clear</Button></div></form>;
}

function DecisionRecordCard({ item, onNotice, onUpdated }: { item: DecisionRecordItem; onNotice: (notice: { text: string; tone: "success" | "error" }) => void; onUpdated: (item: DecisionRecordItem) => void }) {
  const [feedback, setFeedback] = useState(item.currentFeedback);
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
      setFeedback(next); onUpdated({ ...item, currentFeedback: next, feedbackHistory: [...item.feedbackHistory, next] }); onNotice({ text: "Feedback saved.", tone: "success" });
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
  return <Card className="review-record"><div className="review-row"><span className="review-row__mark" aria-hidden="true" /><div><strong>{record.summary}</strong><small>{decisionProject(record)} · {record.confidence} confidence · {formatDate(record.createdAt)}</small></div><span className="review-row__meta">{feedback ? feedbackLabel(feedback.action) : "Unreviewed"}</span><div className="review-row__actions"><Badge variant={feedbackVariant}>{feedback ? feedbackLabel(feedback.action) : "Unreviewed"}</Badge></div></div><div className="review-detail"><h3>{record.choice}</h3><p>{record.context}</p><div className="review-evidence">{record.evidence.map((evidence) => <blockquote key={`${record.decisionRecordId}-${evidence.excerpt}`}>{evidence.excerpt}<div className="app-mono">{evidence.commitHashes.join(" · ")}</div></blockquote>)}</div><Label className="review-comment-field">Reviewer comment<Textarea value={comment} onChange={(event) => setComment(event.currentTarget.value)} placeholder="Optional context for this feedback" /></Label><div className="review-actions"><Button type="button" variant="default" size="sm" disabled={busy} onClick={() => void giveFeedback("up")}>Reasonable here</Button><Button type="button" variant="destructive" size="sm" disabled={busy} onClick={() => void giveFeedback("down")}>Should not repeat</Button><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void giveFeedback("dismiss")}>Dismiss</Button>{feedback && !item.promotionCandidateId ? <Button type="button" variant="secondary" size="sm" onClick={() => setPromotionOpen(true)}>Draft candidate</Button> : null}</div>{item.promotionCandidateId ? <Alert variant="default" data-tone="success">Candidate drafted · {item.promotionCandidateId}</Alert> : null}</div><Dialog open={promotionOpen} onOpenChange={setPromotionOpen}><DialogContent><DialogHeader><DialogTitle>Draft a field-guide candidate</DialogTitle><DialogDescription>This creates an inactive candidate. It does not change active guidance.</DialogDescription></DialogHeader><form className="manage-form" onSubmit={promote}><Label>Lesson key<Input name="lessonKey" defaultValue={slugify(record.summary)} required /></Label><Label>Title<Input name="title" defaultValue={record.summary} required /></Label><Label className="manage-form__wide">Guidance<Textarea name="body" defaultValue={record.choice} required /></Label><Label className="manage-form__wide">Rationale<Textarea name="rationale" defaultValue={feedback?.comment ?? record.rationale} required /></Label><div className="manage-actions"><Button type="submit" variant="secondary" disabled={promotionBusy}>{promotionBusy ? "Drafting…" : "Create inactive candidate"}</Button><Button type="button" variant="ghost" onClick={() => setPromotionOpen(false)}>Cancel</Button></div></form></DialogContent></Dialog></Card>;
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

function Empty({ title, body }: { title: string; body: string }) { return <div className="app-empty"><h2>{title}</h2><p>{body}</p></div>; }

function reviewTitle(search: ReviewSearch) { return search.view === "decisions" ? "Decision inbox" : search.view === "queue" ? "Pending candidates" : "Decision history"; }
function summaryLabel(data: ReviewPageData, search: ReviewSearch) { if (search.view === "decisions") return `${data.decisions?.pending ?? 0} unresolved`; if (search.view === "queue") return `${data.queue?.summary.pending ?? 0} pending`; return `${data.history?.decisions.length ?? 0} loaded`; }
function decisionProject(record: DecisionRecordItem["record"]) { return record.foundProjectDisplayName ?? record.foundProjectKey ?? record.projectDisplayName ?? record.projectKey ?? "Global"; }
function feedbackLabel(action: DecisionFeedback["action"]) { return action === "up" ? "Reasonable here" : action === "down" ? "Should not repeat" : "Dismissed"; }
function humanAction(action: Decision["action"]) { return action === "approve" ? "Approved" : action === "reject" ? "Rejected" : action === "defer" ? "Deferred" : action === "confirm_valid" ? "Confirmed valid" : "Marked invalid"; }
function relativeTime(value: string) { const time = new Date(value).getTime(); if (!Number.isFinite(time)) return value; const minutes = Math.round((time - Date.now()) / 60_000); const absolute = Math.abs(minutes); const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" }); if (absolute < 60) return formatter.format(minutes, "minute"); const hours = Math.round(minutes / 60); if (Math.abs(hours) < 24) return formatter.format(hours, "hour"); return formatter.format(Math.round(hours / 24), "day"); }
function formatDate(value: string) { return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(value)); }
function slugify(value: string) { return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "field-guide-lesson"; }
function reviewHref(search: ReviewSearch) { const params = new URLSearchParams({ scope: search.scope, view: search.view }); if (search.view === "decisions") params.set("reviewState", search.reviewState); addSearchFilters(params, search); return `/review?${params}`; }
function addSearchFilters(params: URLSearchParams, search: ReviewSearch) { for (const key of ["projectKey", "taskId", "device", "harness", "skill", "from", "to"] as const) if (search[key]) params.set(key, search[key]!); }

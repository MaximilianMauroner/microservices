import { useMemo, useState } from "react";
import { ArrowUpRightIcon, CheckIcon, CopyIcon, FileTextIcon, PlusIcon, SearchIcon } from "lucide-react";
import type { MarkdownAdminDocument } from "@tools-platform/web";
import { AppShell } from "../../src/components/app-shell.js";
import { favicons } from "../../src/favicons.js";
import { AppSelect } from "../../src/components/form-controls.js";
import { Alert } from "../../src/components/ui/alert.js";
import { Badge } from "../../src/components/ui/badge.js";
import { Button } from "../../src/components/ui/button.js";
import { Card, CardDescription, CardHeader, CardTitle } from "../../src/components/ui/card.js";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../../src/components/ui/empty.js";
import { Input } from "../../src/components/ui/input.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../src/components/ui/table.js";
import { useIsMobile } from "../../src/components/ui/use-mobile.js";
import type { DocumentsPageData } from "../../src/protected-data.js";
import { formatDateTime } from "../../src/lib/format-date.js";
import { PageHeader } from "../../src/components/page-header.js";
import { toggleVisibleAll, toggleVisibleRange } from "../../src/lib/range-selection.js";

type CheckpointFilter = "all" | "with" | "without";
type ExpiryFilter = "all" | "24" | "72" | "168";
type SortOrder = "updated-desc" | "expiry-asc" | "created-desc" | "name-asc";

export function DocumentsPage({ initial }: { initial: DocumentsPageData }) {
  const isMobile = useIsMobile();
  const [query, setQuery] = useState("");
  const [checkpoints, setCheckpoints] = useState<CheckpointFilter>("all");
  const [expiry, setExpiry] = useState<ExpiryFilter>("all");
  const [sort, setSort] = useState<SortOrder>("updated-desc");
  const [copied, setCopied] = useState<string>();
  const [mobileLimit, setMobileLimit] = useState(50);
  const [loadedDocuments, setLoadedDocuments] = useState(initial.documents);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [anchor, setAnchor] = useState<string>();
  const documents = useMemo(() => filterDocuments(loadedDocuments, initial.generatedAt, { query, checkpoints, expiry, sort }), [checkpoints, expiry, loadedDocuments, initial.generatedAt, query, sort]);
  const editedRecently = loadedDocuments.filter((document) => document.updatedAt >= initial.generatedAt - 86_400_000).length;
  const nextExpiry = [...loadedDocuments].sort((left, right) => left.expiresAt - right.expiresAt)[0];
  const expiringSoon = loadedDocuments.filter((document) => document.expiresAt <= initial.generatedAt + 86_400_000).length;
  const withCheckpoints = loadedDocuments.filter((document) => document.checkpointCount > 0).length;
  const visible = isMobile ? documents.slice(0, mobileLimit) : documents;
  const allSelected = visible.length > 0 && visible.every((document) => selectedIds.has(document.token));

  function updateFilter(action: () => void) { setSelectedIds(new Set()); setAnchor(undefined); action(); }
  function toggle(document: MarkdownAdminDocument, shiftKey: boolean) {
    setSelectedIds((current) => toggleVisibleRange(current, visible.map((item) => item.token), anchor, document.token, shiftKey));
    if (!shiftKey) setAnchor(document.token);
  }
  async function loadMore() {
    if (!nextCursor || loading) return;
    setLoading(true); setLoadError(undefined);
    try {
      const response = await fetch(`/api/ops/documents?cursor=${encodeURIComponent(nextCursor)}&asOf=${initial.generatedAt}`, { credentials: "same-origin" });
      if (!response.ok) throw new Error("Older documents could not be loaded.");
      const page = await response.json() as DocumentsPageData;
      setLoadedDocuments((current) => [...current, ...page.documents.filter((document) => !current.some((item) => item.token === document.token))]);
      setNextCursor(page.nextCursor);
    } catch { setLoadError("Older documents could not be loaded. Try again."); }
    finally { setLoading(false); }
  }
  async function searchRemaining() {
    if (!nextCursor || loading) return;
    setLoading(true); setLoadError(undefined);
    try {
      let cursor: string | undefined = nextCursor;
      const remaining: MarkdownAdminDocument[] = [];
      while (cursor) {
        const response = await fetch(`/api/ops/documents?cursor=${encodeURIComponent(cursor)}&asOf=${initial.generatedAt}`, { credentials: "same-origin" });
        if (!response.ok) throw new Error("Older documents could not be loaded.");
        const page = await response.json() as DocumentsPageData;
        remaining.push(...page.documents); cursor = page.nextCursor;
      }
      setLoadedDocuments((current) => [...current, ...remaining.filter((document) => !current.some((item) => item.token === document.token))]);
      setNextCursor(undefined);
    } catch { setLoadError("Search could not cover all older documents. Try again."); }
    finally { setLoading(false); }
  }
  async function copyLink(document: MarkdownAdminDocument) {
    try {
      await navigator.clipboard.writeText(documentUrl(document, initial.publicOrigin));
      setCopied(document.token);
      window.setTimeout(() => setCopied((current) => current === document.token ? undefined : current), 1800);
    } catch { setCopied(undefined); }
  }
  async function copySelected() {
    try {
      await navigator.clipboard.writeText(documents.filter((document) => selectedIds.has(document.token)).map((document) => documentUrl(document, initial.publicOrigin)).join("\n"));
      setSelectedIds(new Set());
    } catch { setLoadError("Selected links could not be copied. Try again."); }
  }
  const selectionBox = (document: MarkdownAdminDocument) => <input type="checkbox" className="size-4 accent-primary" aria-label={`Select ${document.filename}`} checked={selectedIds.has(document.token)} readOnly onClick={(event) => { event.stopPropagation(); toggle(document, event.shiftKey); }} />;

  return <>
    <AppShell product="Markdown Share" accent="rose" icon={favicons.markdownShare} />
    <main id="main" className="tools-page">
      <PageHeader title="Documents" facts={`${loadedDocuments.length}${nextCursor ? "+ documents loaded" : " active"} · ${editedRecently} edited today${nextCursor ? " among loaded" : ""} · ${nextExpiry ? `${nextCursor ? "earliest loaded expiry" : "next expiry"} in ${remaining(nextExpiry.expiresAt, initial.generatedAt)}` : "no expiry due"}`} actions={<Button nativeButton={false} size="sm" render={<a href={new URL("/markdown", initial.publicOrigin).toString()} target="_blank" rel="noreferrer" />}><PlusIcon />New document<ArrowUpRightIcon /></Button>} />
      {nextCursor ? <Alert className="mb-3">More documents are available. Search and filters apply to loaded documents.</Alert> : null}
      {loadError ? <Alert className="mb-3" variant="destructive" role="alert">{loadError}</Alert> : null}
      <section className="mb-3 flex flex-wrap items-center gap-2" aria-label="Document filters">
        <label className="relative block w-full sm:max-w-sm"><SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input className="pl-9" type="search" value={query} onChange={(event) => updateFilter(() => setQuery(event.currentTarget.value))} placeholder="Search file name" aria-label="Search documents" /></label>
        <button type="button" aria-pressed={expiry === "24"} className={`rounded-full border px-3 py-1.5 text-xs ${expiry === "24" ? "border-primary bg-primary/10" : "text-muted-foreground hover:bg-accent"}`} onClick={() => updateFilter(() => setExpiry(expiry === "24" ? "all" : "24"))}>Expires within 24 h <span className="tabular-nums">{expiringSoon}</span></button>
        <button type="button" aria-pressed={checkpoints === "with"} className={`rounded-full border px-3 py-1.5 text-xs ${checkpoints === "with" ? "border-primary bg-primary/10" : "text-muted-foreground hover:bg-accent"}`} onClick={() => updateFilter(() => setCheckpoints(checkpoints === "with" ? "all" : "with"))}>With checkpoints <span className="tabular-nums">{withCheckpoints}</span></button>
        <AppSelect value={sort} onValueChange={(value) => updateFilter(() => setSort(value as SortOrder))} aria-label="Sort documents" className="w-40" options={[{ value: "updated-desc", label: "Recently edited" }, { value: "expiry-asc", label: "Expiring soon" }, { value: "created-desc", label: "Newest created" }, { value: "name-asc", label: "Filename A–Z" }]} />
      </section>
      {selectedIds.size ? <div className="mb-2 flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm"><strong>{selectedIds.size} selected</strong><Button size="sm" variant="outline" onClick={() => void copySelected()}><CopyIcon />Copy links</Button><Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Clear</Button></div> : null}
      <Card className="gap-0 overflow-hidden py-0">
        {documents.length === 0 ? <Empty className="min-h-72"><EmptyHeader><EmptyMedia variant="icon"><FileTextIcon /></EmptyMedia><EmptyTitle>{nextCursor ? "No matches in loaded documents" : "No documents match"}</EmptyTitle><EmptyDescription>{nextCursor ? "Older documents have not been searched yet." : "Adjust the filters or create a new Markdown document."}</EmptyDescription>{nextCursor ? <Button type="button" disabled={loading} onClick={() => void searchRemaining()}>{loading ? "Searching older documents…" : "Search remaining documents"}</Button> : null}</EmptyHeader></Empty> : isMobile ? <div className="divide-y" role="list" aria-label="Document inventory">{visible.map((document) => <article className="flex items-center gap-3 p-3" key={document.token} role="listitem">{selectionBox(document)}<div className="min-w-0 flex-1"><strong className="block truncate text-sm">{document.filename}</strong><span className="text-xs text-muted-foreground">Edited {relativePast(document.updatedAt, initial.generatedAt)} · {document.checkpointCount} checkpoints</span></div><span className={`shrink-0 text-xs ${document.expiresAt - initial.generatedAt <= 86_400_000 ? "text-warning" : "text-muted-foreground"}`}>{remaining(document.expiresAt, initial.generatedAt)} left</span><Button nativeButton={false} size="icon-sm" variant="ghost" aria-label={`Open ${document.filename}`} render={<a href={documentUrl(document, initial.publicOrigin)} target="_blank" rel="noreferrer" />}><ArrowUpRightIcon /></Button></article>)}{visible.length < documents.length ? <div className="p-3 text-center"><Button variant="outline" onClick={() => setMobileLimit((current) => current + 50)}>Show 50 more</Button></div> : null}</div> : <div className="overflow-x-auto"><Table className="a3-select-table"><TableHeader><TableRow><TableHead className="w-10"><input type="checkbox" className="size-4 accent-primary" aria-label="Select all visible documents" checked={allSelected} readOnly onClick={() => setSelectedIds((current) => toggleVisibleAll(current, visible.map((document) => document.token)))} /></TableHead><TableHead>Document</TableHead><TableHead>Last edit</TableHead><TableHead className="text-right">Checkpoints</TableHead><TableHead>Time left</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader><TableBody>{documents.map((document) => <TableRow key={document.token}><TableCell>{selectionBox(document)}</TableCell><TableCell className="min-w-56"><div className="font-medium">{document.filename}</div><div className="text-xs text-muted-foreground">Created {relativePast(document.createdAt, initial.generatedAt)}</div></TableCell><TableCell className="text-xs text-muted-foreground">{relativePast(document.updatedAt, initial.generatedAt)}</TableCell><TableCell className="text-right text-xs tabular-nums">{document.checkpointCount}</TableCell><TableCell><span className={document.expiresAt - initial.generatedAt <= 86_400_000 ? "text-warning" : ""}>{remaining(document.expiresAt, initial.generatedAt)} left</span></TableCell><TableCell><div className="flex justify-end gap-1"><Button type="button" variant="ghost" size="icon-sm" aria-label={`Copy link for ${document.filename}`} onClick={() => void copyLink(document)}>{copied === document.token ? <CheckIcon /> : <CopyIcon />}</Button><Button nativeButton={false} variant="ghost" size="icon-sm" aria-label={`Open ${document.filename}`} render={<a href={documentUrl(document, initial.publicOrigin)} target="_blank" rel="noreferrer" />}><ArrowUpRightIcon /></Button></div></TableCell></TableRow>)}</TableBody></Table></div>}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-xs text-muted-foreground"><span>Documents expire 7 days after the last edit, or 30 days when pinned.</span>{nextCursor ? <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void loadMore()}>{loading ? "Loading more documents…" : "Load more documents"}</Button> : null}</div>
      </Card>
    </main>
  </>;
}

export function MobileDocumentInventory({ documents, total, generatedAt, publicOrigin, copied, onCopy, onShowMore }: { documents: MarkdownAdminDocument[]; total: number; generatedAt: number; publicOrigin: string; copied?: string; onCopy: (document: MarkdownAdminDocument) => void; onShowMore: () => void }) {
  return <div className="divide-y" role="list" aria-label="Document inventory">
    {documents.map((document) => <article className="space-y-3 p-4" key={document.token} role="listitem">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><h2 className="truncate text-sm font-semibold">{document.filename}</h2><p className="mt-1 text-xs text-muted-foreground">Edited {relativePast(document.updatedAt, generatedAt)} · {document.checkpointCount} {document.checkpointCount === 1 ? "checkpoint" : "checkpoints"}</p></div>
        <Badge variant={document.expiresAt - generatedAt <= 86_400_000 ? "warning" : "outline"}>{remaining(document.expiresAt, generatedAt)} left</Badge>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" onClick={() => onCopy(document)}>{copied === document.token ? <CheckIcon /> : <CopyIcon />}{copied === document.token ? "Copied" : "Copy link"}</Button>
        <Button nativeButton={false} render={<a href={documentUrl(document, publicOrigin)} target="_blank" rel="noreferrer" />}>Open<ArrowUpRightIcon /></Button>
      </div>
    </article>)}
    {documents.length < total ? <div className="p-3 text-center"><Button type="button" variant="outline" onClick={onShowMore}>Show 50 more</Button></div> : null}
  </div>;
}


export function filterDocuments(documents: MarkdownAdminDocument[], now: number, filters: { query: string; checkpoints: CheckpointFilter; expiry: ExpiryFilter; sort: SortOrder }) {
  const query = filters.query.trim().toLocaleLowerCase();
  const expiryLimit = filters.expiry === "all" ? null : now + Number(filters.expiry) * 3_600_000;
  return documents.filter((document) => (!query || document.filename.toLocaleLowerCase().includes(query)) && (filters.checkpoints === "all" || (filters.checkpoints === "with" ? document.checkpointCount > 0 : document.checkpointCount === 0)) && (expiryLimit === null || document.expiresAt <= expiryLimit)).sort((left, right) => filters.sort === "expiry-asc" ? left.expiresAt - right.expiresAt : filters.sort === "created-desc" ? right.createdAt - left.createdAt : filters.sort === "name-asc" ? left.filename.localeCompare(right.filename) : right.updatedAt - left.updatedAt);
}

function documentUrl(document: MarkdownAdminDocument, publicOrigin: string) { return new URL(`/markdown/d/${encodeURIComponent(document.filename)}--${encodeURIComponent(document.token)}`, publicOrigin).toString(); }
function relativePast(value: number, now: number) { const minutes = Math.floor(Math.max(0, now - value) / 60_000); if (minutes < 1) return "just now"; if (minutes < 60) return `${minutes}m ago`; const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours}h ago`; return `${Math.floor(hours / 24)}d ago`; }
function remaining(value: number, now: number) { const hours = Math.ceil(Math.max(0, value - now) / 3_600_000); if (hours < 24) return `${hours}h`; const days = Math.ceil(hours / 24); return `${days}d`; }

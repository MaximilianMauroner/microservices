import { useMemo, useState, type ReactNode } from "react";
import { ArrowUpRightIcon, CheckIcon, CopyIcon, FileTextIcon, PlusIcon, SearchIcon } from "lucide-react";
import type { MarkdownAdminDocument } from "@tools-platform/web";
import { AppShell } from "../../src/components/app-shell.js";
import { PageHeader } from "../../src/components/page-header.js";
import { favicons } from "../../src/favicons.js";
import { Alert } from "../../src/components/ui/alert.js";
import { Button } from "../../src/components/ui/button.js";
import { Card } from "../../src/components/ui/card.js";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../../src/components/ui/empty.js";
import { Input } from "../../src/components/ui/input.js";
import { NativeSelect, NativeSelectOption } from "../../src/components/ui/native-select.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../src/components/ui/table.js";
import { Toggle } from "../../src/components/ui/toggle.js";
import { useIsMobile } from "../../src/components/ui/use-mobile.js";
import type { DocumentsPageData } from "../../src/protected-data.js";
import { formatDate, formatDateTime } from "../../src/lib/format-date.js";
import { cn } from "../../src/lib/utils.js";

type SortOrder = "updated-desc" | "expiry-asc" | "created-desc" | "name-asc";
interface DocumentFilters { query: string; expiringSoon: boolean; withCheckpoints: boolean; sort: SortOrder }

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Markdown Share keeps a document 7 days after the last edit, or 30 days when pinned. */
const RETENTION_MS = 7 * DAY_MS;
const PINNED_RETENTION_MS = 30 * DAY_MS;
const MOBILE_PAGE = 50;
const sortOptions: [SortOrder, string][] = [["updated-desc", "Recently edited"], ["expiry-asc", "Expiring soon"], ["created-desc", "Newest"], ["name-asc", "Name"]];

export function DocumentsPage({ initial }: { initial: DocumentsPageData }) {
  const now = initial.generatedAt;
  const isMobile = useIsMobile();
  const [query, setQuery] = useState("");
  const [expiringSoon, setExpiringSoon] = useState(false);
  const [withCheckpoints, setWithCheckpoints] = useState(false);
  const [sort, setSort] = useState<SortOrder>("updated-desc");
  const [copied, setCopied] = useState<string>();
  const [mobileLimit, setMobileLimit] = useState(MOBILE_PAGE);
  const [loadedDocuments, setLoadedDocuments] = useState(initial.documents);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const documents = useMemo(() => filterDocuments(loadedDocuments, now, { query, expiringSoon, withCheckpoints, sort }), [expiringSoon, loadedDocuments, now, query, sort, withCheckpoints]);
  const visibleDocuments = isMobile ? documents.slice(0, mobileLimit) : documents;
  const today = formatDate(now);
  const editedToday = loadedDocuments.filter((document) => formatDate(document.updatedAt) === today).length;
  const nextExpiry = Math.min(...loadedDocuments.map((document) => document.expiresAt));

  async function loadMore() {
    if (!nextCursor || loading) return;
    setLoading(true);
    setLoadError(undefined);
    try {
      const response = await fetch(`/api/ops/documents?cursor=${encodeURIComponent(nextCursor)}&asOf=${now}`, { credentials: "same-origin" });
      if (!response.ok) throw new Error("Older documents could not be loaded.");
      const page = await response.json() as DocumentsPageData;
      setLoadedDocuments((current) => [...current, ...page.documents.filter((document) => !current.some((item) => item.token === document.token))]);
      setNextCursor(page.nextCursor);
    } catch {
      setLoadError("Older documents could not be loaded. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function searchRemaining() {
    if (!nextCursor || loading) return;
    setLoading(true);
    setLoadError(undefined);
    try {
      let cursor: string | undefined = nextCursor;
      const remaining: MarkdownAdminDocument[] = [];
      while (cursor) {
        const response = await fetch(`/api/ops/documents?cursor=${encodeURIComponent(cursor)}&asOf=${now}`, { credentials: "same-origin" });
        if (!response.ok) throw new Error("Older documents could not be loaded.");
        const page = await response.json() as DocumentsPageData;
        remaining.push(...page.documents);
        cursor = page.nextCursor;
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
    } catch {
      setCopied(undefined);
    }
  }

  return <>
    <AppShell product="Markdown Share" accent="rose" icon={favicons.markdownShare} />
    <main id="main" className="tools-page">
      <PageHeader
        title="Documents"
        facts={`${loadedDocuments.length}${nextCursor ? "+" : ""} active · ${editedToday} edited today${loadedDocuments.length ? ` · next expiry in ${timeLeft(nextExpiry, now)}` : ""}`}
        actions={<Button nativeButton={false} render={<a href={new URL("/markdown", initial.publicOrigin).toString()} target="_blank" rel="noreferrer" />}><PlusIcon />New document</Button>}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-[1_1_220px] md:max-w-80">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="search" className="pl-8" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search file name" aria-label="Search documents" />
        </div>
        <FilterChip pressed={expiringSoon} onPressedChange={setExpiringSoon} count={loadedDocuments.filter((document) => expiresSoon(document, now)).length} warn>Expires within 24 h</FilterChip>
        <FilterChip pressed={withCheckpoints} onPressedChange={setWithCheckpoints} count={loadedDocuments.filter((document) => document.checkpointCount > 0).length}>With checkpoints</FilterChip>
        <NativeSelect className="w-40" value={sort} onChange={(event) => { const value = event.currentTarget.value; const option = sortOptions.find(([order]) => order === value); if (option) setSort(option[0]); }} aria-label="Sort documents">
          {sortOptions.map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}
        </NativeSelect>
      </div>

      {nextCursor ? <Alert className="mb-3">More documents are available. Search and filters apply to loaded documents.</Alert> : null}
      {loadError ? <Alert className="mb-3" variant="destructive" role="alert">{loadError}</Alert> : null}
      <Card className="gap-0 py-0">
        {documents.length === 0 ? (
          <Empty className="min-h-72">
            <EmptyHeader>
              <EmptyMedia variant="icon"><FileTextIcon /></EmptyMedia>
              <EmptyTitle>{nextCursor ? "No matches in loaded documents" : "No documents match"}</EmptyTitle>
              <EmptyDescription>{nextCursor ? "Older documents have not been searched yet." : "Change the filters or create a new Markdown document."}</EmptyDescription>
              {nextCursor ? <Button type="button" disabled={loading} onClick={() => void searchRemaining()}>{loading ? "Searching older documents…" : "Search remaining documents"}</Button> : null}
            </EmptyHeader>
          </Empty>
        ) : (
          <Table className="text-[0.8125rem]">
            <TableHeader>
              <TableRow className="text-xs hover:bg-transparent [&>th]:font-normal [&>th]:text-muted-foreground">
                <TableHead className="pl-4">Document</TableHead>
                <TableHead className="max-md:hidden">Last edit</TableHead>
                <TableHead className="text-right max-md:hidden">Checkpoints</TableHead>
                <TableHead>Time left</TableHead>
                <TableHead className="pr-4"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleDocuments.map((document) => (
                <DocumentRow key={document.token} document={document} now={now} publicOrigin={initial.publicOrigin} copied={copied === document.token} onCopy={() => void copyLink(document)} />
              ))}
            </TableBody>
          </Table>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5 text-xs text-muted-foreground">
          <span>Documents expire 7 days after the last edit, or 30 days when pinned.</span>
          {visibleDocuments.length < documents.length ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setMobileLimit((current) => current + MOBILE_PAGE)}>Show 50 more</Button>
          ) : nextCursor ? (
            <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void loadMore()}>{loading ? "Loading…" : "Load more"}</Button>
          ) : null}
        </div>
      </Card>
    </main>
  </>;
}

function FilterChip({ pressed, onPressedChange, count, warn = false, children }: { pressed: boolean; onPressedChange: (pressed: boolean) => void; count: number; warn?: boolean; children: ReactNode }) {
  return (
    <Toggle
      pressed={pressed}
      onPressedChange={onPressedChange}
      className="h-8 gap-1.5 rounded-full border border-control-border bg-control px-3 text-[0.8125rem] hover:border-control-border-hover hover:bg-control-hover aria-pressed:border-primary/50 aria-pressed:bg-secondary aria-pressed:text-secondary-foreground"
    >
      {children}
      <b className={cn("font-semibold tabular-nums", warn && "text-warning")}>{count}</b>
    </Toggle>
  );
}

function DocumentRow({ document, now, publicOrigin, copied, onCopy }: { document: MarkdownAdminDocument; now: number; publicOrigin: string; copied: boolean; onCopy: () => void }) {
  const soon = expiresSoon(document, now);
  const pinned = isPinned(document);
  const share = Math.min(1, Math.max(0, (document.expiresAt - now) / (pinned ? PINNED_RETENTION_MS : RETENTION_MS)));
  const edited = relativePast(document.updatedAt, now);
  const url = documentUrl(document, publicOrigin);
  return (
    <TableRow>
      <TableCell className="w-full max-w-0 py-2.5 pl-4">
        <span className="block truncate font-medium">{document.filename}</span>
        <span className="block truncate text-xs text-muted-foreground">
          Created {formatDate(document.createdAt)}{pinned ? " · pinned" : ""}<span className="md:hidden"> · edited {edited}</span>
        </span>
      </TableCell>
      <TableCell className="text-muted-foreground max-md:hidden" title={formatDateTime(document.updatedAt)}>{edited}</TableCell>
      <TableCell className="text-right tabular-nums max-md:hidden">{document.checkpointCount || <span className="text-muted-foreground">0</span>}</TableCell>
      <TableCell title={`Expires ${formatDateTime(document.expiresAt)}`}>
        <span className={cn("block text-xs tabular-nums", soon && "text-warning")}>{timeLeft(document.expiresAt, now)}</span>
        <span className="mt-1 block h-1 w-18 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <span className={cn("block h-full rounded-full", soon ? "bg-warning" : "bg-muted-foreground")} style={{ width: `${Math.round(share * 100)}%` }} />
        </span>
      </TableCell>
      <TableCell className="pr-4 text-right">
        <div className="inline-flex gap-0.5">
          <Button type="button" variant="ghost" size="icon-sm" aria-label={copied ? "Link copied" : `Copy link to ${document.filename}`} onClick={onCopy}>{copied ? <CheckIcon /> : <CopyIcon />}</Button>
          <Button nativeButton={false} variant="ghost" size="icon-sm" aria-label={`Open ${document.filename}`} render={<a href={url} target="_blank" rel="noreferrer" />}><ArrowUpRightIcon /></Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function filterDocuments(documents: MarkdownAdminDocument[], now: number, filters: DocumentFilters) {
  const query = filters.query.trim().toLocaleLowerCase();
  return documents
    .filter((document) => (!query || document.filename.toLocaleLowerCase().includes(query))
      && (!filters.expiringSoon || expiresSoon(document, now))
      && (!filters.withCheckpoints || document.checkpointCount > 0))
    .sort((left, right) => filters.sort === "expiry-asc" ? left.expiresAt - right.expiresAt : filters.sort === "created-desc" ? right.createdAt - left.createdAt : filters.sort === "name-asc" ? left.filename.localeCompare(right.filename) : right.updatedAt - left.updatedAt);
}

/**
 * The inventory API does not send the pin flag. Markdown Share always sets the expiry to the last edit plus
 * the retention window, so a window longer than 7 days means the document is pinned.
 */
function isPinned(document: MarkdownAdminDocument) { return document.expiresAt - document.updatedAt > RETENTION_MS; }
function expiresSoon(document: MarkdownAdminDocument, now: number) { return document.expiresAt - now <= DAY_MS; }
function documentUrl(document: MarkdownAdminDocument, publicOrigin: string) { return new URL(`/markdown/d/${encodeURIComponent(document.filename)}--${encodeURIComponent(document.token)}`, publicOrigin).toString(); }
function relativePast(value: number, now: number) { const minutes = Math.floor(Math.max(0, now - value) / 60_000); if (minutes < 1) return "just now"; if (minutes < 60) return `${minutes} min ago`; const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours} h ago`; return `${Math.floor(hours / 24)} d ago`; }
/** "1 h", "6 d 21 h", "24 d": hours are shown only inside the normal 7-day window. */
function timeLeft(value: number, now: number) { const hours = Math.ceil(Math.max(0, value - now) / HOUR_MS); if (hours < 24) return `${hours} h`; const days = Math.floor(hours / 24); return days < 7 && hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`; }

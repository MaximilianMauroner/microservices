import { useMemo, useState } from "react";
import { ArrowUpRightIcon, CheckIcon, CopyIcon, FileTextIcon, PlusIcon } from "lucide-react";
import type { MarkdownAdminDocument } from "@tools-platform/web";
import { AppShell } from "../../src/components/app-shell.js";
import { AppSelect } from "../../src/components/form-controls.js";
import { Alert } from "../../src/components/ui/alert.js";
import { Badge } from "../../src/components/ui/badge.js";
import { Button } from "../../src/components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../src/components/ui/card.js";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../../src/components/ui/empty.js";
import { Input } from "../../src/components/ui/input.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../src/components/ui/table.js";
import type { DocumentsPageData } from "../../src/protected-data.js";

type CheckpointFilter = "all" | "with" | "without";
type ExpiryFilter = "all" | "24" | "72" | "168";
type SortOrder = "updated-desc" | "expiry-asc" | "created-desc" | "name-asc";

export function DocumentsPage({ initial }: { initial: DocumentsPageData }) {
  const [query, setQuery] = useState("");
  const [checkpoints, setCheckpoints] = useState<CheckpointFilter>("all");
  const [expiry, setExpiry] = useState<ExpiryFilter>("all");
  const [sort, setSort] = useState<SortOrder>("updated-desc");
  const [copied, setCopied] = useState<string>();
  const documents = useMemo(() => filterDocuments(initial.documents, initial.generatedAt, { query, checkpoints, expiry, sort }), [checkpoints, expiry, initial.documents, initial.generatedAt, query, sort]);
  const editedRecently = initial.documents.filter((document) => document.updatedAt >= initial.generatedAt - 86_400_000).length;
  const checkpointVersions = initial.documents.reduce((total, document) => total + document.checkpointCount, 0);
  const nextExpiry = [...initial.documents].sort((left, right) => left.expiresAt - right.expiresAt)[0];

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
    <AppShell product="Markdown Share" showSignOut />
    <main id="main" className="workspace-page">
      <header className="workspace-header">
        <div>
          <p className="workspace-header__eyebrow">Markdown Share</p>
          <h1>Manage active documents.</h1>
          <p className="workspace-header__description">Find expiring work, verify checkpoints, and open the document that needs attention.</p>
        </div>
        <div className="workspace-header__actions"><Button nativeButton={false} render={<a href={initial.publicOrigin} target="_blank" rel="noreferrer" />}><PlusIcon />New document<ArrowUpRightIcon /></Button></div>
      </header>

      <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Document overview">
        <Metric label="Active documents" value={String(initial.documents.length)} detail={initial.truncated ? "First 200 loaded" : "Complete inventory"} />
        <Metric label="Edited in 24 hours" value={String(editedRecently)} detail="Recent activity" />
        <Metric label="Checkpoint versions" value={String(checkpointVersions)} detail="Durable recovery points" />
        <Metric label="Next expiry" value={nextExpiry ? remaining(nextExpiry.expiresAt, initial.generatedAt) : "None"} detail={nextExpiry?.filename ?? "No active documents"} attention={Boolean(nextExpiry && nextExpiry.expiresAt - initial.generatedAt <= 86_400_000)} />
      </section>

      {initial.truncated ? <Alert className="mb-4">Showing the first 200 active documents.</Alert> : null}
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="border-b py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div><CardTitle>Document inventory</CardTitle><CardDescription>{documents.length} of {initial.documents.length} documents shown · signed in as {initial.actor}</CardDescription></div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(13rem,1fr)_11rem_10rem_11rem]">
              <Input type="search" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search filename" aria-label="Search documents" />
              <AppSelect value={checkpoints} onValueChange={(value) => setCheckpoints(value as CheckpointFilter)} aria-label="Filter by checkpoints" options={[{ value: "all", label: "All checkpoints" }, { value: "with", label: "With checkpoints" }, { value: "without", label: "Without checkpoints" }]} />
              <AppSelect value={expiry} onValueChange={(value) => setExpiry(value as ExpiryFilter)} aria-label="Filter by expiry" options={[{ value: "all", label: "Any expiry" }, { value: "24", label: "Next 24 hours" }, { value: "72", label: "Next 3 days" }, { value: "168", label: "Next 7 days" }]} />
              <AppSelect value={sort} onValueChange={(value) => setSort(value as SortOrder)} aria-label="Sort documents" options={[{ value: "updated-desc", label: "Recently edited" }, { value: "expiry-asc", label: "Expiring soon" }, { value: "created-desc", label: "Newest created" }, { value: "name-asc", label: "Filename A–Z" }]} />
            </div>
          </div>
        </CardHeader>
        {documents.length === 0 ? <Empty className="min-h-72"><EmptyHeader><EmptyMedia variant="icon"><FileTextIcon /></EmptyMedia><EmptyTitle>No documents match</EmptyTitle><EmptyDescription>Adjust the filters or create a new Markdown document.</EmptyDescription></EmptyHeader></Empty> : <div className="overflow-x-auto"><Table>
          <TableHeader><TableRow><TableHead>Document</TableHead><TableHead>Last activity</TableHead><TableHead>Checkpoints</TableHead><TableHead>Expires</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
          <TableBody>{documents.map((document) => <TableRow key={document.token}>
            <TableCell className="min-w-56"><div className="font-medium">{document.filename}</div><div className="mt-1 text-xs text-muted-foreground">Created {relativePast(document.createdAt, initial.generatedAt)}</div></TableCell>
            <TableCell><div>{relativePast(document.updatedAt, initial.generatedAt)}</div><div className="text-xs text-muted-foreground">{formatDate(document.updatedAt)}</div></TableCell>
            <TableCell><Badge variant={document.checkpointCount ? "secondary" : "outline"}>{document.checkpointCount} {document.checkpointCount === 1 ? "version" : "versions"}</Badge></TableCell>
            <TableCell><div className={document.expiresAt - initial.generatedAt <= 86_400_000 ? "text-destructive" : ""}>{remaining(document.expiresAt, initial.generatedAt)}</div><div className="text-xs text-muted-foreground">{formatDate(document.expiresAt)}</div></TableCell>
            <TableCell><div className="flex justify-end gap-1"><Button type="button" variant="ghost" size="sm" onClick={() => void copyLink(document)}>{copied === document.token ? <CheckIcon /> : <CopyIcon />}{copied === document.token ? "Copied" : "Copy"}</Button><Button nativeButton={false} variant="ghost" size="sm" render={<a href={documentUrl(document, initial.publicOrigin)} target="_blank" rel="noreferrer" />}>Open<ArrowUpRightIcon /></Button></div></TableCell>
          </TableRow>)}</TableBody>
        </Table></div>}
      </Card>
    </main>
  </>;
}

function Metric({ label, value, detail, attention = false }: { label: string; value: string; detail: string; attention?: boolean }) {
  return <Card className={attention ? "border-destructive/60" : ""}><CardContent><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p><strong className={attention ? "mt-2 block text-2xl text-destructive" : "mt-2 block text-2xl"}>{value}</strong><p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p></CardContent></Card>;
}

export function filterDocuments(documents: MarkdownAdminDocument[], now: number, filters: { query: string; checkpoints: CheckpointFilter; expiry: ExpiryFilter; sort: SortOrder }) {
  const query = filters.query.trim().toLocaleLowerCase();
  const expiryLimit = filters.expiry === "all" ? null : now + Number(filters.expiry) * 3_600_000;
  return documents.filter((document) => (!query || document.filename.toLocaleLowerCase().includes(query)) && (filters.checkpoints === "all" || (filters.checkpoints === "with" ? document.checkpointCount > 0 : document.checkpointCount === 0)) && (expiryLimit === null || document.expiresAt <= expiryLimit)).sort((left, right) => filters.sort === "expiry-asc" ? left.expiresAt - right.expiresAt : filters.sort === "created-desc" ? right.createdAt - left.createdAt : filters.sort === "name-asc" ? left.filename.localeCompare(right.filename) : right.updatedAt - left.updatedAt);
}

function documentUrl(document: MarkdownAdminDocument, publicOrigin: string) { return new URL(`/d/${encodeURIComponent(document.filename)}--${encodeURIComponent(document.token)}`, publicOrigin).toString(); }
function relativePast(value: number, now: number) { const minutes = Math.floor(Math.max(0, now - value) / 60_000); if (minutes < 1) return "just now"; if (minutes < 60) return `${minutes}m ago`; const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours}h ago`; return `${Math.floor(hours / 24)}d ago`; }
function remaining(value: number, now: number) { const hours = Math.ceil(Math.max(0, value - now) / 3_600_000); if (hours < 24) return `${hours}h`; const days = Math.ceil(hours / 24); return `${days}d`; }
function formatDate(value: number) { return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }

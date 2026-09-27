import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { Link } from "@tanstack/react-router";
import {
  Copy,
  CalendarClock,
  Download,
  ExternalLink,
  FileText,
  Folder,
  RefreshCw,
  Search,
  Trash2,
  Upload
} from "lucide-react";
import { AppShell } from "../../src/components/app-shell.js";
import { favicons } from "../../src/favicons.js";
import { AppSelect } from "../../src/components/form-controls.js";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "../../src/components/ui/alert-dialog.js";
import { Alert } from "../../src/components/ui/alert.js";
import { Badge } from "../../src/components/ui/badge.js";
import { Button } from "../../src/components/ui/button.js";
import { Card } from "../../src/components/ui/card.js";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../src/components/ui/dialog.js";
import { Input } from "../../src/components/ui/input.js";
import { NativeSelect } from "../../src/components/ui/native-select.js";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../src/components/ui/sheet.js";
import { useIsMobile } from "../../src/components/ui/use-mobile.js";
import { Switch } from "../../src/components/ui/switch.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../src/components/ui/table.js";
import type { ManagePageData, UploadInventorySummary, UploadSummary } from "../../src/protected-data.js";
import { fetchPublisherRead, waitForPublisher } from "./publisher-request.js";
import { formatDateTime } from "../../src/lib/format-date.js";
import { PageHeader } from "../../src/components/page-header.js";
import { toggleVisibleAll, toggleVisibleRange } from "../../src/lib/range-selection.js";

type KindFilter = "all" | UploadSummary["kind"];
type ExpiryFilter = "all" | "24h" | "7d" | "persistent";
type SortOrder = "newest" | "oldest" | "filename" | "expiry";
type ProjectUsageGroup = {
  label: string;
  projects: Array<[string, number]>;
};

const ALL_PROJECTS = "__all__";
const UNASSIGNED_PROJECT = "__unassigned__";

export function ManagePage({ initial }: { initial: ManagePageData }) {
  const isMobile = useIsMobile();
  const [uploads, setUploads] = useState(initial.uploads);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [summary, setSummary] = useState<UploadInventorySummary>(() => initial.summary ?? summarizeLoaded(initial.uploads));
  const [selectedId, setSelectedId] = useState<string | undefined>(initial.uploads[0]?.id);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [selectionAnchor, setSelectionAnchor] = useState<string>();
  const [projectFilter, setProjectFilter] = useState(ALL_PROJECTS);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [expiry, setExpiry] = useState<ExpiryFilter>("all");
  const [sort, setSort] = useState<SortOrder>("newest");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "success" | "error" }>();
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const replaceInput = useRef<HTMLInputElement>(null);
  const loadingAllRef = useRef(false);
  const [loadingAll, setLoadingAll] = useState(false);

  const projects = useMemo(() => summary.projects
    .map(({ project, count }) => [project ?? UNASSIGNED_PROJECT, count] as [string, number])
    .sort(([left], [right]) => left === UNASSIGNED_PROJECT ? 1 : right === UNASSIGNED_PROJECT ? -1 : left.localeCompare(right)), [summary]);
  const visibleUploads = useMemo(
    () => filterAndSortUploads(uploads, { projectFilter, query, kind, expiry, sort }),
    [expiry, kind, projectFilter, query, sort, uploads]
  );
  const selected = visibleUploads.find((upload) => upload.id === selectedId);
  useEffect(() => { setSelectedIds(new Set()); setSelectionAnchor(undefined); }, [projectFilter, query, kind, expiry, sort]);
  useEffect(() => {
    function onDelete(event: KeyboardEvent) {
      const target = event.target;
      if (event.key !== "Delete" || selectedIds.size === 0 || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)) return;
      event.preventDefault();
      setBulkConfirmOpen(true);
    }
    window.addEventListener("keydown", onDelete);
    return () => window.removeEventListener("keydown", onDelete);
  }, [selectedIds]);

  function toggleSelection(id: string, shiftKey: boolean, additive = true) {
    const ids = visibleUploads.map((upload) => upload.id);
    setSelectedIds((current) => toggleVisibleRange(additive ? current : new Set(), ids, selectionAnchor, id, shiftKey));
    if (!shiftKey) setSelectionAnchor(id);
  }

  async function revokeSelection() {
    const ids = visibleUploads.filter((upload) => selectedIds.has(upload.id));
    setBulkConfirmOpen(false);
    if (!ids.length) return;
    setBusy(true);
    const revoked: string[] = [];
    try {
      await waitForPublisher();
      for (const upload of ids) {
        const response = await fetch(`/api/external-uploads/${upload.id}`, { method: "DELETE", credentials: "same-origin" });
        if (!response.ok) await readPayload(response, `${upload.filename} could not be revoked.`);
        revoked.push(upload.id);
      }
      setMessage({ text: `${revoked.length} capability ${revoked.length === 1 ? "URL was" : "URLs were"} revoked and can no longer be used.`, tone: "success" });
    } catch (error) {
      setMessage({ text: `${revoked.length} revoked. ${errorMessage(error)}`, tone: "error" });
    } finally {
      setUploads((current) => current.filter((upload) => !revoked.includes(upload.id)));
      setSelectedIds(new Set());
      setSelectedId((current) => revoked.includes(current ?? "") ? uploads.find((upload) => !revoked.includes(upload.id))?.id : current);
      if (revoked.length) { try { await refreshSummary(); } catch { /* Keep the successful revocations visible. */ } }
      setBusy(false);
    }
  }

  async function refresh(options: { announce?: boolean } = {}) {
    setBusy(true);
    try {
      const response = await fetchPublisherRead("/api/external-uploads?limit=100&sort=newest&includeSummary=true", {
        credentials: "same-origin"
      });
      const payload = await readPayload<ManagePageData>(response, "Artifact inventory could not be refreshed.");
      const refreshed = [...payload.uploads];
      setUploads(refreshed);
      setNextCursor(payload.nextCursor);
      if (payload.summary) setSummary(payload.summary);
      setSelectedId((current) => refreshed.some((upload) => upload.id === current)
        ? current
        : refreshed[0]?.id);
      if (options.announce) setMessage({ text: "Artifact inventory refreshed.", tone: "success" });
    } catch (error) {
      setMessage({ text: errorMessage(error), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function loadOlder() {
    if (!nextCursor) return;
    setBusy(true);
    try {
      const response = await fetchPublisherRead(`/api/external-uploads?limit=100&sort=newest&cursor=${encodeURIComponent(nextCursor)}`, {
        credentials: "same-origin"
      });
      const payload = await readPayload<ManagePageData>(response, "Older artifacts could not be loaded.");
      setUploads((current) => [...current, ...payload.uploads]);
      setNextCursor(payload.nextCursor);
    } catch (error) {
      setMessage({ text: errorMessage(error), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function refreshSummary() {
    const response = await fetchPublisherRead(
      "/api/external-uploads?limit=1&sort=newest&includeSummary=true",
      { credentials: "same-origin" }
    );
    const payload = await readPayload<ManagePageData>(
      response,
      "Artifact summary could not be refreshed."
    );
    if (payload.summary) setSummary(payload.summary);
  }

  async function loadCompleteLibrary() {
    if (!nextCursor || loadingAllRef.current) return;
    loadingAllRef.current = true;
    setLoadingAll(true);
    setBusy(true);
    try {
      let cursor: string | undefined = nextCursor;
      const remaining: UploadSummary[] = [];
      while (cursor) {
        const response = await fetchPublisherRead(
          `/api/external-uploads?limit=100&sort=newest&cursor=${encodeURIComponent(cursor)}`,
          { credentials: "same-origin" }
        );
        const payload = await readPayload<ManagePageData>(
          response,
          "Project artifacts could not be loaded."
        );
        remaining.push(...payload.uploads);
        cursor = payload.nextCursor;
      }
      setUploads((current) => [...current, ...remaining]);
      setNextCursor(undefined);
    } catch (error) {
      setMessage({ text: errorMessage(error), tone: "error" });
    } finally {
      loadingAllRef.current = false;
      setLoadingAll(false);
      setBusy(false);
    }
  }

  function selectProject(value: string) { setProjectFilter(value); }

  async function replaceSelected(file: File) {
    if (!selected || selected.kind !== "html") return;
    setBusy(true);
    setMessage(undefined);
    try {
      await waitForPublisher();
      const form = new FormData();
      if (selected.project) form.set("project", selected.project);
      form.set("file", file);
      const response = await fetch(`/api/external-uploads/${selected.id}`, {
        method: "PUT",
        credentials: "same-origin",
        body: form
      });
      const updated = await readPayload<UploadSummary>(response, "Artifact could not be replaced.");
      setUploads((current) => current.map((upload) => upload.id === updated.id ? updated : upload));
      setSelectedId(updated.id);
      setMessage({ text: `${updated.filename} replaced the artifact without changing its URL.`, tone: "success" });
    } catch (error) {
      setMessage({ text: errorMessage(error), tone: "error" });
    } finally {
      setBusy(false);
      if (replaceInput.current) replaceInput.current.value = "";
    }
  }

  async function changeProject(project: string) {
    if (!selected || selected.kind !== "html") return;
    setBusy(true);
    setMessage(undefined);
    try {
      await waitForPublisher();
      const response = await fetch(`/api/external-uploads/${selected.id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project })
      });
      await readPayload(response, "Project could not be changed.");
      setUploads((current) => current.map((upload) => upload.id === selected.id
        ? { ...upload, project }
        : upload));
      await refreshSummary();
      setMessage({ text: `Moved ${selected.filename} to ${project}.`, tone: "success" });
    } catch (error) {
      setMessage({ text: errorMessage(error), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function changeFileExpiry(expiresAt: string | null) {
    if (!selected || selected.kind !== "file") return false;
    setBusy(true);
    setMessage(undefined);
    try {
      await waitForPublisher();
      const response = await fetch(`/api/external-uploads/${selected.id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresAt })
      });
      const updated = await readPayload<{ expiresAt: string | null }>(response, "File expiry could not be changed.");
      setUploads((current) => current.map((upload) => {
        if (upload.id !== selected.id) return upload;
        const { expiresAt: _oldExpiry, ...withoutExpiry } = upload;
        return updated.expiresAt ? { ...withoutExpiry, expiresAt: updated.expiresAt } : withoutExpiry;
      }));
      await refreshSummary();
      setMessage({
        text: updated.expiresAt
          ? `${selected.filename} now expires ${formatDateTime(updated.expiresAt)}.`
          : `${selected.filename} is now permanent and remains available until revoked.`,
        tone: "success"
      });
      return true;
    } catch (error) {
      setMessage({ text: errorMessage(error), tone: "error" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function revokeSelected() {
    if (!selected) return;
    setBusy(true);
    setMessage(undefined);
    try {
      await waitForPublisher();
      const response = await fetch(`/api/external-uploads/${selected.id}`, {
        method: "DELETE",
        credentials: "same-origin"
      });
      if (!response.ok) await readPayload(response, "Artifact could not be revoked.");
      const remaining = uploads.filter((upload) => upload.id !== selected.id);
      setUploads(remaining);
      setSelectedId(remaining[0]?.id);
      await refreshSummary();
      setMessage({ text: `${selected.filename} was revoked. Its capability URL no longer works.`, tone: "success" });
    } catch (error) {
      setMessage({ text: errorMessage(error), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function copyUrl(upload: UploadSummary) {
    try {
      await navigator.clipboard.writeText(upload.url);
      setMessage({ text: "Capability URL copied.", tone: "success" });
    } catch {
      setMessage({ text: "The URL could not be copied. Open the artifact to copy it manually.", tone: "error" });
    }
  }
  async function copySelectedUrl() { if (selected) await copyUrl(selected); }

  return (
    <>
      <AppShell product="Publisher" accent="violet" icon={favicons.publisher} />
      <main id="main" className="tools-page">
        <PageHeader title="Library" facts={`${summary.total} artifacts in ${summary.projects.length} projects`} actions={<>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void refresh({ announce: true })}>
              <RefreshCw /> Refresh
            </Button>
            <Button nativeButton={false} size="sm" render={<Link to="/publisher" preload="intent" />}>
              <Upload /> Publish new
            </Button>
          </>} />

        {message ? <Alert className="mb-4" variant={message.tone === "error" ? "destructive" : "default"}>{message.text}</Alert> : null}

        <section className="mb-3 flex flex-wrap items-center gap-2" aria-label="Artifact filters">
          <label className="relative block w-full lg:max-w-md">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input className="pl-9" value={query} onChange={(event) => { setQuery(event.currentTarget.value); }} placeholder="Search artifacts, URLs, or projects" aria-label="Search artifacts" />
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            {([ ["all", "All", summary.total], ["html", "Plans", uploads.filter((upload) => upload.kind === "html").length], ["file", "Files", uploads.filter((upload) => upload.kind === "file").length] ] as const).map(([value, label, count]) => <button key={value} type="button" aria-pressed={kind === value} className={`rounded-full border px-3 py-1.5 text-xs ${kind === value ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-accent"}`} onClick={() => setKind(value)}>{label} <span className="tabular-nums">{count}{nextCursor && value !== "all" ? "+" : ""}</span></button>)}
            {([ ["24h", "Expiring soon", summary.expiringSoon], ["7d", "Next 7 days", null], ["persistent", "Permanent", summary.permanent] ] as const).map(([value, label, count]) => <button key={value} type="button" aria-pressed={expiry === value} className={`rounded-full border px-3 py-1.5 text-xs ${expiry === value ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-accent"}`} onClick={() => setExpiry(expiry === value ? "all" : value)}>{label}{count === null ? "" : ` ${count}`}</button>)}
          </div>
          <div className="flex flex-wrap gap-2 lg:ml-auto">
            <NativeSelect aria-label="Project" className="w-44" value={projectFilter} onChange={(event) => selectProject(event.currentTarget.value)}><option value={ALL_PROJECTS}>All projects</option>{projects.find(([value]) => value === UNASSIGNED_PROJECT) ? <option value={UNASSIGNED_PROJECT}>Unassigned ({projects.find(([value]) => value === UNASSIGNED_PROJECT)?.[1]})</option> : null}{groupProjectsByUsage(projects).map((group) => <optgroup key={group.label} label={group.label}>{group.projects.map(([value, count]) => <option key={value} value={value}>{value} ({count})</option>)}</optgroup>)}</NativeSelect>
            <AppSelect value={sort} onValueChange={(value) => { setSort(value as SortOrder); }} aria-label="Sort artifacts" className="w-40" options={[{ value: "newest", label: "Newest" }, { value: "oldest", label: "Oldest" }, { value: "filename", label: "Filename" }, { value: "expiry", label: "Expiry" }]} />
          </div>
        </section>

        {selectedIds.size ? <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm"><strong>{selectedIds.size} selected</strong><Button size="sm" variant="destructive-subtle" disabled={busy} onClick={() => setBulkConfirmOpen(true)}><Trash2 />Revoke selected…</Button><Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>Clear</Button></div> : null}
        <section className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]" aria-label="Artifact library">
          <ArtifactTable uploads={visibleUploads} loaded={uploads.length} total={summary.total} selectedId={selectedId} selectedIds={selectedIds} onToggle={toggleSelection} onToggleAll={() => setSelectedIds((current) => toggleVisibleAll(current, visibleUploads.map((upload) => upload.id)))} onSelect={(id) => { setSelectedId(id); setMobileInspectorOpen(true); }} onCopy={copyUrl} hasMore={Boolean(nextCursor)} busy={busy} loadingAll={loadingAll} onLoadMore={loadOlder} onSearchRemaining={loadCompleteLibrary} />
          {!isMobile ? <ArtifactInspector
            key={selected?.id ?? "none"}
            upload={selected}
            busy={busy}
            knownProjects={projects.map(([project]) => project)}
            replaceInput={replaceInput}
            onReplace={replaceSelected}
            onChangeProject={changeProject}
            onChangeExpiry={changeFileExpiry}
            onCopy={copySelectedUrl}
            onRevoke={revokeSelected}
          /> : null}
        </section>
        {isMobile ? <Sheet open={mobileInspectorOpen} onOpenChange={setMobileInspectorOpen}><SheetContent className="w-full overflow-y-auto"><SheetHeader className="border-b"><SheetTitle>Artifact details</SheetTitle><SheetDescription>Inspect and maintain one shared artifact.</SheetDescription></SheetHeader><div className="p-4 pt-0"><ArtifactInspector key={selected?.id ?? "none"} upload={selected} busy={busy} knownProjects={projects.map(([project]) => project)} replaceInput={replaceInput} onReplace={replaceSelected} onChangeProject={changeProject} onChangeExpiry={changeFileExpiry} onCopy={copySelectedUrl} onRevoke={revokeSelected} /></div></SheetContent></Sheet> : null}
        <AlertDialog open={bulkConfirmOpen} onOpenChange={setBulkConfirmOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Revoke {selectedIds.size} selected {selectedIds.size === 1 ? "artifact" : "artifacts"}?</AlertDialogTitle><AlertDialogDescription>Their public capability URLs will stop working immediately. This cannot be undone.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void revokeSelection()}>Revoke permanently</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      </main>
    </>
  );
}

export function groupProjectsByUsage(projects: Array<[string, number]>): ProjectUsageGroup[] {
  const assigned = projects
    .filter(([project]) => project !== UNASSIGNED_PROJECT)
    .toSorted(([leftProject, leftCount], [rightProject, rightCount]) => rightCount - leftCount || leftProject.localeCompare(rightProject));
  const definitions: Array<{ label: string; minimum: number; maximum: number }> = [
    { label: "100+ uses", minimum: 100, maximum: Number.POSITIVE_INFINITY },
    { label: "10–99 uses", minimum: 10, maximum: 99 },
    { label: "2–9 uses", minimum: 2, maximum: 9 },
    { label: "One-off projects", minimum: 1, maximum: 1 }
  ];

  return definitions
    .map(({ label, minimum, maximum }) => ({
      label,
      projects: assigned.filter(([, count]) => count >= minimum && count <= maximum)
    }))
    .filter((group) => group.projects.length > 0);
}

function ArtifactTable({ uploads, loaded, total, selectedId, selectedIds, onToggle, onToggleAll, onSelect, onCopy, hasMore, busy, loadingAll, onLoadMore, onSearchRemaining }: { uploads: UploadSummary[]; loaded: number; total: number; selectedId?: string; selectedIds: Set<string>; onToggle: (id: string, shiftKey: boolean, additive?: boolean) => void; onToggleAll: () => void; onSelect: (id: string) => void; onCopy: (upload: UploadSummary) => Promise<void>; hasMore: boolean; busy: boolean; loadingAll: boolean; onLoadMore: () => Promise<void>; onSearchRemaining: () => Promise<void> }) {
  const isMobile = useIsMobile();
  const [mobileLimit, setMobileLimit] = useState(50);
  const shown = isMobile ? uploads.slice(0, mobileLimit) : uploads;
  const allSelected = shown.length > 0 && shown.every((upload) => selectedIds.has(upload.id));
  const selectionBox = (upload: UploadSummary) => <input
    type="checkbox" className="size-4 shrink-0 accent-primary" aria-label={`Select ${upload.filename}`}
    checked={selectedIds.has(upload.id)} readOnly
    onClick={(event) => { event.stopPropagation(); onToggle(upload.id, event.shiftKey); }}
  />;
  return <Card className="gap-0 overflow-hidden py-0">
    <div className="flex items-center justify-between border-b px-4 py-3"><h2 className="font-semibold">Artifacts</h2><span className="text-xs text-muted-foreground">{uploads.length === loaded ? `${loaded} of ${total} loaded` : `${uploads.length} shown · ${loaded} of ${total} loaded`}</span></div>
    {loadingAll ? <p className="border-b px-4 py-2 text-xs text-muted-foreground" role="status">Loading the full library so search and filters include older artifacts…</p> : null}
    {uploads.length === 0 ? <div className="grid min-h-72 place-items-center p-8 text-center"><div><h3 className="font-semibold">{loadingAll ? "Searching the full library…" : hasMore ? "No matches in loaded artifacts" : "No artifacts match"}</h3><p className="mt-1 text-sm text-muted-foreground">{loadingAll ? "Older artifacts are still loading." : hasMore ? "Older artifacts have not been searched yet." : "Try another search, project, or lifecycle filter."}</p></div></div> : isMobile ? <div className="divide-y" role="list" aria-label="Artifacts">{shown.map((upload) => <article key={upload.id} role="listitem" className="flex items-center gap-2 px-3">{selectionBox(upload)}<button className={`grid min-h-16 min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-2 text-left transition-colors hover:bg-muted${selectedId === upload.id ? " bg-secondary" : ""}`} type="button" aria-current={selectedId === upload.id ? "true" : undefined} onClick={(event) => event.shiftKey || event.ctrlKey || event.metaKey ? onToggle(upload.id, event.shiftKey) : onSelect(upload.id)}><span className="grid size-9 shrink-0 place-items-center rounded-md border text-muted-foreground">{upload.kind === "html" ? <FileText /> : <Download />}</span><span className="min-w-0"><strong className="block truncate text-sm">{upload.filename}</strong><small className="mt-1 block truncate text-xs text-muted-foreground">{upload.project ?? "Unassigned"} · {formatRelativeDate(upload.updatedAt)}</small></span><LifecycleBadge upload={upload} /></button></article>)}{shown.length < uploads.length ? <div className="p-3 text-center"><Button type="button" variant="outline" onClick={() => setMobileLimit((current) => current + 50)}>Show 50 more</Button></div> : null}</div> : <div className="overflow-x-auto"><Table className="a3-select-table"><TableHeader><TableRow><TableHead className="w-10"><input type="checkbox" className="size-4 accent-primary" aria-label="Select all visible artifacts" checked={allSelected} readOnly onClick={() => onToggleAll()} /></TableHead><TableHead>Artifact</TableHead><TableHead>Project</TableHead><TableHead>Lifecycle</TableHead><TableHead>Updated</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader><TableBody>{uploads.map((upload) => <TableRow key={upload.id} data-state={selectedId === upload.id ? "selected" : undefined} className={`cursor-pointer${selectedId === upload.id ? " shadow-[inset_2px_0_var(--primary)]" : ""}`} onClick={(event) => event.shiftKey || event.ctrlKey || event.metaKey ? onToggle(upload.id, event.shiftKey) : onSelect(upload.id)}><TableCell>{selectionBox(upload)}</TableCell><TableCell className="w-full max-w-0"><button className="flex w-full min-w-0 items-center gap-3 text-left" type="button" onClick={(event) => { event.stopPropagation(); if (event.shiftKey || event.ctrlKey || event.metaKey) onToggle(upload.id, event.shiftKey); else onSelect(upload.id); }}><span className="grid size-8 shrink-0 place-items-center rounded-md border text-muted-foreground">{upload.kind === "html" ? <FileText /> : <Download />}</span><span className="min-w-0"><strong className="block truncate text-sm">{upload.filename}</strong><small className="block truncate font-mono text-xs text-muted-foreground">{shortUrl(upload.url)}</small></span></button></TableCell><TableCell className="max-w-36 truncate text-xs text-muted-foreground">{upload.project ?? "Unassigned"}</TableCell><TableCell><LifecycleBadge upload={upload} /></TableCell><TableCell className="text-xs text-muted-foreground">{formatRelativeDate(upload.updatedAt)}</TableCell><TableCell><div className="flex gap-1"><Button size="icon-sm" variant="ghost" aria-label={`Copy link for ${upload.filename}`} onClick={(event) => { event.stopPropagation(); void onCopy(upload); }}><Copy /></Button><Button nativeButton={false} size="icon-sm" variant="ghost" aria-label={`Open ${upload.filename}`} render={<a href={upload.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} />}><ExternalLink /></Button></div></TableCell></TableRow>)}</TableBody></Table></div>}
    {hasMore ? <div className="flex flex-wrap justify-center gap-2 border-t p-3"><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void onLoadMore()}>Load older artifacts</Button><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void onSearchRemaining()}>Search remaining artifacts</Button></div> : null}
  </Card>;
}

function ArtifactInspector({ upload, busy, knownProjects, replaceInput, onReplace, onChangeProject, onChangeExpiry, onCopy, onRevoke }: { upload?: UploadSummary; busy: boolean; knownProjects: string[]; replaceInput: RefObject<HTMLInputElement | null>; onReplace: (file: File) => Promise<void>; onChangeProject: (project: string) => Promise<void>; onChangeExpiry: (expiresAt: string | null) => Promise<boolean>; onCopy: () => Promise<void>; onRevoke: () => Promise<void> }) {
  const [project, setProject] = useState(upload?.project ?? "");
  const currentProject = upload?.project ?? "";
  if (!upload) return <Card className="grid min-h-64 place-items-center p-6 text-center text-sm text-muted-foreground">Select an artifact.</Card>;
  const canUpdate = upload.kind === "html";
  const projectChanged = project.trim() !== currentProject && project.trim().length > 0;
  return <Card key={upload.id} className="gap-0 py-0 lg:sticky lg:top-[4.5rem]">
    <div className="border-b p-4"><LifecycleBadge upload={upload} /><h2 className="mt-3 break-words font-semibold">{upload.filename}</h2><p className="mt-1 text-xs text-muted-foreground">{formatBytes(upload.bytes)} · updated {formatDateTime(upload.updatedAt)}</p></div>
    <dl className="grid gap-0"><InspectorDetail label="Capability URL" value={upload.url} mono /><InspectorDetail label="Content type" value={upload.contentType} /><InspectorDetail label="Identifier" value={upload.id} mono /></dl>
    <div className="grid grid-cols-2 gap-2 border-t p-3"><Input ref={replaceInput} className="hidden" type="file" accept=".html,.htm,text/html,application/xhtml+xml" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void onReplace(file); }} aria-label="Choose replacement HTML file" tabIndex={-1} /><Button type="button" variant="outline" size="sm" disabled={!canUpdate || busy} onClick={() => replaceInput.current?.click()}><Upload /> Replace file</Button><Button nativeButton={false} variant="outline" size="sm" render={<a href={upload.url} target="_blank" rel="noreferrer" />}><ExternalLink /> Open</Button><Button type="button" variant="outline" size="sm" onClick={() => void onCopy()}><Copy /> Copy URL</Button></div>
    {canUpdate ? <div className="border-t p-3"><label className="text-xs font-medium" htmlFor="artifact-project">Project</label><div className="mt-2 flex gap-2"><Input id="artifact-project" list="artifact-projects" value={project} onChange={(event) => setProject(event.currentTarget.value)} placeholder="Project name" /><datalist id="artifact-projects">{knownProjects.filter((value) => value !== UNASSIGNED_PROJECT).map((value) => <option key={value} value={value} />)}</datalist><Button type="button" variant="outline" size="sm" disabled={!projectChanged || busy} onClick={() => void onChangeProject(project.trim())}><Folder /> Save</Button></div></div> : <FileExpiryControl upload={upload} busy={busy} onChange={onChangeExpiry} />}
    <div className="border-t border-destructive/30 p-3"><h3 className="text-xs font-semibold text-destructive">Revoke artifact</h3><p className="mt-1 text-xs text-muted-foreground">The capability URL will stop working immediately.</p><AlertDialog><AlertDialogTrigger className="mt-3" render={<Button type="button" variant="destructive-outline" size="sm" disabled={busy} />}><Trash2 /> Revoke…</AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Revoke {upload.filename}?</AlertDialogTitle><AlertDialogDescription>This permanently removes the stored artifact. Anyone using its capability URL will receive a not-found response.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void onRevoke()}>Revoke artifact</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>
  </Card>;
}

function FileExpiryControl({ upload, busy, onChange }: { upload: UploadSummary; busy: boolean; onChange: (expiresAt: string | null) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [permanent, setPermanent] = useState(!upload.expiresAt);
  const [expiry, setExpiry] = useState(() => formatDateTimeLocal(upload.expiresAt ? new Date(upload.expiresAt) : addDays(new Date(), 3)));
  const parsedExpiry = new Date(expiry);
  const validExpiry = !Number.isNaN(parsedExpiry.getTime()) && parsedExpiry > new Date();

  function selectDuration(days: number) {
    setPermanent(false);
    setExpiry(formatDateTimeLocal(addDays(new Date(), days)));
  }

  async function save() {
    if (!permanent && !validExpiry) return;
    if (await onChange(permanent ? null : parsedExpiry.toISOString())) setOpen(false);
  }

  return <div className="border-t p-3">
    <div className="flex items-center justify-between gap-3">
      <div><h3 className="text-xs font-medium">File expiry</h3><p className="mt-1 text-xs text-muted-foreground">{upload.expiresAt ? `${formatTimeRemaining(upload.expiresAt)} left · ${formatDateTime(upload.expiresAt)}` : "Permanent · available until revoked"}</p></div>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setOpen(true)}><CalendarClock /> Change</Button>
    </div>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>Change file expiry</DialogTitle><DialogDescription>{upload.filename} {upload.expiresAt ? `expires ${formatDateTime(upload.expiresAt)}.` : "is permanent."}</DialogDescription></DialogHeader>
        <div className="flex items-center justify-between gap-4 rounded-lg border p-3"><div><label className="text-sm font-medium" htmlFor="file-permanent">Permanent</label><p className="mt-1 text-xs text-muted-foreground">Keep the file until you revoke it.</p></div><Switch id="file-permanent" checked={permanent} onCheckedChange={setPermanent} aria-label="Keep file permanently" /></div>
        <div className={permanent ? "pointer-events-none opacity-40" : ""} aria-disabled={permanent}>
          <p className="mb-2 text-xs font-medium">Keep from now</p>
          <div className="grid grid-cols-3 gap-2">{[1, 3, 7, 14, 30].map((days) => <Button key={days} type="button" variant="outline" size="sm" onClick={() => selectDuration(days)}>{days} {days === 1 ? "day" : "days"}</Button>)}</div>
          <label className="mt-4 block text-xs font-medium" htmlFor="file-expiry">Exact expiry</label>
          <Input id="file-expiry" className="mt-2" type="datetime-local" value={expiry} min={formatDateTimeLocal(new Date())} onChange={(event) => { setPermanent(false); setExpiry(event.currentTarget.value); }} disabled={permanent} />
          <p className={`mt-2 text-xs ${validExpiry ? "text-muted-foreground" : "text-destructive"}`}>{validExpiry ? `New expiry: ${formatDateTime(parsedExpiry.toISOString())}` : "Choose a future date and time."}</p>
        </div>
        <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="button" disabled={busy || (!permanent && !validExpiry)} onClick={() => void save()}>{busy ? "Saving…" : "Change expiry"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}

function InspectorDetail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="border-b px-4 py-3 last:border-b-0"><dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</dt><dd className={`mt-1 break-all text-xs${mono ? " font-mono" : ""}`}>{value}</dd></div>;
}

function LifecycleBadge({ upload }: { upload: UploadSummary }) {
  if (upload.kind === "html") return <Badge variant="secondary">Persistent</Badge>;
  if (!upload.expiresAt) return <Badge variant="secondary">Permanent</Badge>;
  const soon = expiresWithin(upload, 24 * 60 * 60 * 1000);
  return <Badge variant={soon ? "warning" : "outline"}>{formatTimeRemaining(upload.expiresAt)} left</Badge>;
}

function projectCounts(uploads: UploadSummary[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const upload of uploads) {
    const project = upload.project ?? UNASSIGNED_PROJECT;
    counts.set(project, (counts.get(project) ?? 0) + 1);
  }
  return [...counts].sort(([left], [right]) => left === UNASSIGNED_PROJECT ? 1 : right === UNASSIGNED_PROJECT ? -1 : left.localeCompare(right));
}

function summarizeLoaded(uploads: UploadSummary[]): UploadInventorySummary {
  return {
    total: uploads.length,
    permanent: uploads.filter((upload) => !upload.expiresAt).length,
    temporary: uploads.filter((upload) => Boolean(upload.expiresAt)).length,
    expiringSoon: uploads.filter((upload) => expiresWithin(upload, 24 * 60 * 60 * 1000)).length,
    projects: projectCounts(uploads).map(([project, count]) => ({
      project: project === UNASSIGNED_PROJECT ? null : project,
      count
    }))
  };
}

function filterAndSortUploads(uploads: UploadSummary[], filters: { projectFilter: string; query: string; kind: KindFilter; expiry: ExpiryFilter; sort: SortOrder }) {
  const now = Date.now();
  const query = filters.query.trim().toLocaleLowerCase();
  return uploads.filter((upload) => {
    const project = upload.project ?? UNASSIGNED_PROJECT;
    if (filters.projectFilter !== ALL_PROJECTS && project !== filters.projectFilter) return false;
    if (filters.kind !== "all" && upload.kind !== filters.kind) return false;
    if (query && !`${upload.filename} ${upload.url} ${upload.project ?? ""}`.toLocaleLowerCase().includes(query)) return false;
    if (filters.expiry === "persistent" && upload.expiresAt) return false;
    if (filters.expiry === "24h" && (!upload.expiresAt || new Date(upload.expiresAt).getTime() > now + 24 * 60 * 60 * 1000)) return false;
    if (filters.expiry === "7d" && (!upload.expiresAt || new Date(upload.expiresAt).getTime() > now + 7 * 24 * 60 * 60 * 1000)) return false;
    return true;
  }).sort((left, right) => {
    if (filters.sort === "filename") return left.filename.localeCompare(right.filename);
    if (filters.sort === "expiry") return expiryTime(left) - expiryTime(right) || left.filename.localeCompare(right.filename);
    const time = new Date(left.updatedAt).getTime() - new Date(right.updatedAt).getTime();
    return filters.sort === "oldest" ? time : -time;
  });
}

function expiryTime(upload: UploadSummary) {
  return upload.expiresAt ? new Date(upload.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
}

function expiresWithin(upload: UploadSummary, windowMs: number) {
  if (!upload.expiresAt) return false;
  const remaining = new Date(upload.expiresAt).getTime() - Date.now();
  return remaining > 0 && remaining <= windowMs;
}

async function readPayload<T = unknown>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json().catch(() => undefined) as { message?: unknown } | undefined;
  if (!response.ok) throw new Error(typeof payload?.message === "string" ? payload.message : fallback);
  return payload as T;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The artifact operation failed.";
}

function shortUrl(value: string) {
  const url = new URL(value);
  return `${url.host}${url.pathname.length > 42 ? `${url.pathname.slice(0, 39)}…` : url.pathname}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}


function formatRelativeDate(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return `${Math.floor(elapsed / 86_400_000)}d ago`;
}

function formatTimeRemaining(value: string) {
  const remaining = Math.max(0, new Date(value).getTime() - Date.now());
  if (remaining < 3_600_000) return `${Math.max(1, Math.ceil(remaining / 60_000))}m`;
  if (remaining < 86_400_000) return `${Math.ceil(remaining / 3_600_000)}h`;
  return `${Math.ceil(remaining / 86_400_000)}d`;
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function formatDateTimeLocal(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

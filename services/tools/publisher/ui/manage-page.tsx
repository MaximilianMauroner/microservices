import { useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { Link } from "@tanstack/react-router";
import {
  Copy,
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
import { Input } from "../../src/components/ui/input.js";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../src/components/ui/sheet.js";
import { useIsMobile } from "../../src/components/ui/use-mobile.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "../../src/components/ui/table.js";
import type { ManagePageData, UploadSummary } from "../../src/protected-data.js";

type KindFilter = "all" | UploadSummary["kind"];
type ExpiryFilter = "all" | "24h" | "7d" | "persistent";
type SortOrder = "newest" | "oldest" | "filename" | "expiry";

const ALL_PROJECTS = "__all__";
const UNASSIGNED_PROJECT = "__unassigned__";

export function ManagePage({ initial }: { initial: ManagePageData }) {
  const isMobile = useIsMobile();
  const [uploads, setUploads] = useState(initial.uploads);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [selectedId, setSelectedId] = useState(initial.uploads[0]?.id);
  const [projectFilter, setProjectFilter] = useState(ALL_PROJECTS);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [expiry, setExpiry] = useState<ExpiryFilter>("all");
  const [sort, setSort] = useState<SortOrder>("newest");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "success" | "error" }>();
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false);
  const replaceInput = useRef<HTMLInputElement>(null);

  const projects = useMemo(() => projectCounts(uploads), [uploads]);
  const visibleUploads = useMemo(
    () => filterAndSortUploads(uploads, { projectFilter, query, kind, expiry, sort }),
    [expiry, kind, projectFilter, query, sort, uploads]
  );
  const selected = uploads.find((upload) => upload.id === selectedId);
  const expiringSoon = uploads.filter((upload) => expiresWithin(upload, 24 * 60 * 60 * 1000)).length;

  async function refresh(options: { announce?: boolean } = {}) {
    setBusy(true);
    try {
      const response = await fetch("/api/external-uploads?limit=100&sort=newest", {
        credentials: "same-origin"
      });
      const payload = await readPayload<ManagePageData>(response, "Artifact inventory could not be refreshed.");
      setUploads(payload.uploads);
      setNextCursor(payload.nextCursor);
      setSelectedId((current) => payload.uploads.some((upload) => upload.id === current)
        ? current
        : payload.uploads[0]?.id);
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
      const response = await fetch(`/api/external-uploads?limit=100&sort=newest&cursor=${encodeURIComponent(nextCursor)}`, {
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

  async function replaceSelected(file: File) {
    if (!selected || selected.kind !== "html") return;
    setBusy(true);
    setMessage(undefined);
    try {
      const form = new FormData();
      if (selected.project) form.set("project", selected.project);
      form.set("file", file);
      const response = await fetch(`/api/external-uploads/${selected.id}`, {
        method: "PUT",
        credentials: "same-origin",
        body: form
      });
      const updated = await readPayload<UploadSummary>(response, "Artifact could not be replaced.");
      await refresh();
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
      setMessage({ text: `Moved ${selected.filename} to ${project}.`, tone: "success" });
    } catch (error) {
      setMessage({ text: errorMessage(error), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function revokeSelected() {
    if (!selected) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const response = await fetch(`/api/external-uploads/${selected.id}`, {
        method: "DELETE",
        credentials: "same-origin"
      });
      if (!response.ok) await readPayload(response, "Artifact could not be revoked.");
      const remaining = uploads.filter((upload) => upload.id !== selected.id);
      setUploads(remaining);
      setSelectedId(remaining[0]?.id);
      setMessage({ text: `${selected.filename} was revoked. Its capability URL no longer works.`, tone: "success" });
    } catch (error) {
      setMessage({ text: errorMessage(error), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function copySelectedUrl() {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected.url);
      setMessage({ text: "Capability URL copied.", tone: "success" });
    } catch {
      setMessage({ text: "The URL could not be copied. Open the artifact to copy it manually.", tone: "error" });
    }
  }

  return (
    <>
      <AppShell product="Publisher" accent="violet" icon={favicons.publisher} showSignOut />
      <main id="main" className="workspace-page workspace-page--wide">
        <section className="workspace-header" aria-labelledby="manage-title">
          <div>
            <p className="workspace-header__eyebrow">Artifact lifecycle</p>
            <h1 id="manage-title">Artifacts.</h1>
            <p className="workspace-header__description">Maintain every plan and file shared through Publish.</p>
          </div>
          <div className="workspace-header__actions">
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void refresh({ announce: true })}>
              <RefreshCw /> Refresh
            </Button>
            <Button nativeButton={false} size="sm" render={<Link to="/publisher" preload="intent" />}>
              <Upload /> Publish new
            </Button>
          </div>
        </section>

        {message ? <Alert className="mb-4" variant={message.tone === "error" ? "destructive" : "default"}>{message.text}</Alert> : null}

        <section className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Artifact summary">
          <Metric label="Artifacts" value={uploads.length} />
          <Metric label="Persistent" value={uploads.filter((upload) => upload.kind === "html").length} />
          <Metric label="Temporary" value={uploads.filter((upload) => upload.kind === "file").length} />
          <Metric label="Expiring soon" value={expiringSoon} attention={expiringSoon > 0} />
        </section>

        <section className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between" aria-label="Artifact filters">
          <label className="relative block w-full lg:max-w-md">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input className="pl-9" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search artifacts, URLs, or projects" aria-label="Search artifacts" />
          </label>
          <div className="grid grid-cols-3 gap-2 sm:flex">
            <AppSelect value={kind} onValueChange={(value) => setKind(value as KindFilter)} aria-label="Filter by type" options={[{ value: "all", label: "All types" }, { value: "html", label: "Plans" }, { value: "file", label: "Files" }]} />
            <AppSelect value={expiry} onValueChange={(value) => setExpiry(value as ExpiryFilter)} aria-label="Filter by expiry" options={[{ value: "all", label: "Any expiry" }, { value: "24h", label: "Next 24 hours" }, { value: "7d", label: "Next 7 days" }, { value: "persistent", label: "Persistent" }]} />
            <AppSelect value={sort} onValueChange={(value) => setSort(value as SortOrder)} aria-label="Sort artifacts" options={[{ value: "newest", label: "Newest" }, { value: "oldest", label: "Oldest" }, { value: "filename", label: "Filename" }, { value: "expiry", label: "Expiry" }]} />
          </div>
        </section>

        <section className="grid items-start gap-3 lg:grid-cols-[12rem_minmax(0,1fr)_20rem]" aria-label="Artifact library">
          <ProjectNavigation projects={projects} active={projectFilter} onSelect={setProjectFilter} total={uploads.length} />
          <ArtifactTable uploads={visibleUploads} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setMobileInspectorOpen(true); }} hasMore={Boolean(nextCursor)} busy={busy} onLoadMore={loadOlder} />
          {!isMobile ? <ArtifactInspector
            key={selected?.id ?? "none"}
            upload={selected}
            busy={busy}
            knownProjects={projects.map(([project]) => project)}
            replaceInput={replaceInput}
            onReplace={replaceSelected}
            onChangeProject={changeProject}
            onCopy={copySelectedUrl}
            onRevoke={revokeSelected}
          /> : null}
        </section>
        {isMobile ? <Sheet open={mobileInspectorOpen} onOpenChange={setMobileInspectorOpen}><SheetContent className="w-full overflow-y-auto"><SheetHeader className="border-b"><SheetTitle>Artifact details</SheetTitle><SheetDescription>Inspect and maintain one shared artifact.</SheetDescription></SheetHeader><div className="p-4 pt-0"><ArtifactInspector key={selected?.id ?? "none"} upload={selected} busy={busy} knownProjects={projects.map(([project]) => project)} replaceInput={replaceInput} onReplace={replaceSelected} onChangeProject={changeProject} onCopy={copySelectedUrl} onRevoke={revokeSelected} /></div></SheetContent></Sheet> : null}
      </main>
    </>
  );
}

function Metric({ label, value, attention = false }: { label: string; value: number; attention?: boolean }) {
  return <Card className="gap-0 p-4"><span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</span><strong className={`mt-1 text-2xl${attention ? " text-amber-300" : ""}`}>{value}</strong></Card>;
}

function ProjectNavigation({ projects, active, onSelect, total }: { projects: Array<[string, number]>; active: string; onSelect: (value: string) => void; total: number }) {
  const unassigned = projects.find(([project]) => project === UNASSIGNED_PROJECT)?.[1] ?? 0;
  return <Card className="gap-0 overflow-hidden py-2"><h2 className="px-3 pb-2 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">Projects</h2><nav className="flex gap-1 overflow-x-auto px-1.5 pb-1 lg:grid lg:gap-0.5 lg:overflow-visible lg:pb-0" aria-label="Artifact projects"><ProjectButton label="All artifacts" count={total} active={active === ALL_PROJECTS} onClick={() => onSelect(ALL_PROJECTS)} />{projects.filter(([project]) => project !== UNASSIGNED_PROJECT).map(([project, count]) => <ProjectButton key={project} label={project} count={count} active={active === project} onClick={() => onSelect(project)} />)}{unassigned ? <ProjectButton label="Unassigned" count={unassigned} active={active === UNASSIGNED_PROJECT} onClick={() => onSelect(UNASSIGNED_PROJECT)} /> : null}</nav></Card>;
}

function ProjectButton({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return <button className={`flex min-h-11 min-w-36 shrink-0 items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors hover:bg-muted lg:min-h-0 lg:min-w-0${active ? " bg-secondary text-foreground" : " text-muted-foreground"}`} type="button" aria-current={active ? "true" : undefined} onClick={onClick}><span className="truncate">{label}</span><Badge variant="outline">{count}</Badge></button>;
}

function ArtifactTable({ uploads, selectedId, onSelect, hasMore, busy, onLoadMore }: { uploads: UploadSummary[]; selectedId?: string; onSelect: (id: string) => void; hasMore: boolean; busy: boolean; onLoadMore: () => Promise<void> }) {
  const isMobile = useIsMobile();
  const [mobileLimit, setMobileLimit] = useState(50);
  const mobileUploads = uploads.slice(0, mobileLimit);
  return <Card className="gap-0 overflow-hidden py-0">
    <div className="flex items-center justify-between border-b px-4 py-3"><h2 className="font-semibold">Artifact library</h2><span className="text-xs text-muted-foreground">{uploads.length} shown</span></div>
    {uploads.length === 0 ? <div className="grid min-h-72 place-items-center p-8 text-center"><div><h3 className="font-semibold">No artifacts match</h3><p className="mt-1 text-sm text-muted-foreground">Try another search, project, or lifecycle filter.</p></div></div> : isMobile ? <div className="divide-y" role="list" aria-label="Artifacts">{mobileUploads.map((upload) => <article key={upload.id} role="listitem"><button className={`grid min-h-20 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 p-3 text-left transition-colors hover:bg-muted${selectedId === upload.id ? " bg-secondary shadow-[inset_3px_0_var(--foreground)]" : ""}`} type="button" aria-current={selectedId === upload.id ? "true" : undefined} onClick={() => onSelect(upload.id)}><span className="grid size-11 shrink-0 place-items-center rounded-md border text-muted-foreground">{upload.kind === "html" ? <FileText /> : <Download />}</span><span className="min-w-0"><strong className="block truncate text-sm">{upload.filename}</strong><small className="mt-1 block truncate text-xs text-muted-foreground">{upload.project ?? "Unassigned"} · {formatRelativeDate(upload.updatedAt)}</small></span><LifecycleBadge upload={upload} /></button></article>)}{mobileUploads.length < uploads.length ? <div className="p-3 text-center"><Button type="button" variant="outline" onClick={() => setMobileLimit((current) => current + 50)}>Show 50 more</Button></div> : null}</div> : <Table><TableHeader><TableRow><TableHead>Artifact</TableHead><TableHead>Project</TableHead><TableHead>Lifecycle</TableHead><TableHead>Updated</TableHead></TableRow></TableHeader><TableBody>{uploads.map((upload) => <TableRow key={upload.id} data-state={selectedId === upload.id ? "selected" : undefined} className={`cursor-pointer${selectedId === upload.id ? " shadow-[inset_2px_0_var(--foreground)]" : ""}`} onClick={() => onSelect(upload.id)}><TableCell><button className="flex max-w-[25rem] items-center gap-3 text-left" type="button"><span className="grid size-9 shrink-0 place-items-center rounded-md border text-muted-foreground">{upload.kind === "html" ? <FileText /> : <Download />}</span><span className="min-w-0"><strong className="block truncate text-sm">{upload.filename}</strong><small className="block truncate font-mono text-xs text-muted-foreground">{shortUrl(upload.url)}</small></span></button></TableCell><TableCell className="text-xs text-muted-foreground">{upload.project ?? "Unassigned"}</TableCell><TableCell><LifecycleBadge upload={upload} /></TableCell><TableCell className="text-xs text-muted-foreground">{formatRelativeDate(upload.updatedAt)}</TableCell></TableRow>)}</TableBody></Table>}
    {hasMore ? <div className="flex justify-center border-t p-3"><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void onLoadMore()}>Load older artifacts</Button></div> : null}
  </Card>;
}

function ArtifactInspector({ upload, busy, knownProjects, replaceInput, onReplace, onChangeProject, onCopy, onRevoke }: { upload?: UploadSummary; busy: boolean; knownProjects: string[]; replaceInput: RefObject<HTMLInputElement | null>; onReplace: (file: File) => Promise<void>; onChangeProject: (project: string) => Promise<void>; onCopy: () => Promise<void>; onRevoke: () => Promise<void> }) {
  const [project, setProject] = useState(upload?.project ?? "");
  const currentProject = upload?.project ?? "";
  if (!upload) return <Card className="grid min-h-64 place-items-center p-6 text-center text-sm text-muted-foreground">Select an artifact.</Card>;
  const canUpdate = upload.kind === "html";
  const projectChanged = project.trim() !== currentProject && project.trim().length > 0;
  return <Card key={upload.id} className="gap-0 py-0 lg:sticky lg:top-[4.5rem]"><div className="border-b p-4"><LifecycleBadge upload={upload} /><h2 className="mt-3 break-words font-semibold">{upload.filename}</h2><p className="mt-1 text-xs text-muted-foreground">{formatBytes(upload.bytes)} · updated {formatDate(upload.updatedAt)}</p></div><dl className="grid gap-0"><InspectorDetail label="Capability URL" value={upload.url} mono /><InspectorDetail label="Content type" value={upload.contentType} /><InspectorDetail label="Identifier" value={upload.id} mono />{upload.expiresAt ? <InspectorDetail label="Expires" value={formatDate(upload.expiresAt)} /> : null}</dl><div className="grid grid-cols-2 gap-2 border-t p-3"><Input ref={replaceInput} className="hidden" type="file" accept=".html,.htm,text/html,application/xhtml+xml" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void onReplace(file); }} aria-label="Choose replacement HTML file" tabIndex={-1} /><Button type="button" size="sm" disabled={!canUpdate || busy} onClick={() => replaceInput.current?.click()}><Upload /> Replace file</Button><Button nativeButton={false} variant="outline" size="sm" render={<a href={upload.url} target="_blank" rel="noreferrer" />}><ExternalLink /> Open</Button><Button type="button" variant="outline" size="sm" onClick={() => void onCopy()}><Copy /> Copy URL</Button></div>{canUpdate ? <div className="border-t p-3"><label className="text-xs font-medium" htmlFor="artifact-project">Project</label><div className="mt-2 flex gap-2"><Input id="artifact-project" list="artifact-projects" value={project} onChange={(event) => setProject(event.currentTarget.value)} placeholder="Project name" /><datalist id="artifact-projects">{knownProjects.filter((value) => value !== UNASSIGNED_PROJECT).map((value) => <option key={value} value={value} />)}</datalist><Button type="button" variant="outline" size="sm" disabled={!projectChanged || busy} onClick={() => void onChangeProject(project.trim())}><Folder /> Save</Button></div></div> : null}<div className="border-t border-rose-950 p-3"><h3 className="text-xs font-semibold text-destructive">Revoke artifact</h3><p className="mt-1 text-xs text-muted-foreground">The capability URL will stop working immediately.</p><AlertDialog><AlertDialogTrigger className="mt-3" render={<Button type="button" variant="destructive" size="sm" disabled={busy} />}><Trash2 /> Revoke…</AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Revoke {upload.filename}?</AlertDialogTitle><AlertDialogDescription>This permanently removes the stored artifact. Anyone using its capability URL will receive a not-found response.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void onRevoke()}>Revoke artifact</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div></Card>;
}

function InspectorDetail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="border-b px-4 py-3 last:border-b-0"><dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</dt><dd className={`mt-1 break-all text-xs${mono ? " font-mono" : ""}`}>{value}</dd></div>;
}

function LifecycleBadge({ upload }: { upload: UploadSummary }) {
  if (upload.kind === "html") return <Badge variant="default">Persistent</Badge>;
  const soon = expiresWithin(upload, 24 * 60 * 60 * 1000);
  return <Badge variant={soon ? "destructive" : "outline"}>{upload.expiresAt ? `${formatTimeRemaining(upload.expiresAt)} left` : "Temporary"}</Badge>;
}

function projectCounts(uploads: UploadSummary[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const upload of uploads) {
    const project = upload.project ?? UNASSIGNED_PROJECT;
    counts.set(project, (counts.get(project) ?? 0) + 1);
  }
  return [...counts].sort(([left], [right]) => left === UNASSIGNED_PROJECT ? 1 : right === UNASSIGNED_PROJECT ? -1 : left.localeCompare(right));
}

function filterAndSortUploads(uploads: UploadSummary[], filters: { projectFilter: string; query: string; kind: KindFilter; expiry: ExpiryFilter; sort: SortOrder }) {
  const now = Date.now();
  const query = filters.query.trim().toLocaleLowerCase();
  return uploads.filter((upload) => {
    const project = upload.project ?? UNASSIGNED_PROJECT;
    if (filters.projectFilter !== ALL_PROJECTS && project !== filters.projectFilter) return false;
    if (filters.kind !== "all" && upload.kind !== filters.kind) return false;
    if (query && !`${upload.filename} ${upload.url} ${upload.project ?? ""}`.toLocaleLowerCase().includes(query)) return false;
    if (filters.expiry === "persistent" && upload.kind !== "html") return false;
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) + " UTC";
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

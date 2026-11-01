import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode, RefObject } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Check, ChevronDown, ChevronUp, Copy, File, FileCode, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import { AppShell } from "../../src/components/app-shell.js";
import { PageHeader } from "../../src/components/page-header.js";
import { Segmented } from "../../src/components/segmented.js";
import { favicons } from "../../src/favicons.js";
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
import { Button } from "../../src/components/ui/button.js";
import { Card } from "../../src/components/ui/card.js";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../src/components/ui/dialog.js";
import { Input } from "../../src/components/ui/input.js";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "../../src/components/ui/native-select.js";
import { Sheet, SheetContent, SheetTitle } from "../../src/components/ui/sheet.js";
import { Switch } from "../../src/components/ui/switch.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../src/components/ui/table.js";
import { countLabel } from "../../src/lib/count-label.js";
import { formatDateTime } from "../../src/lib/format-date.js";
import { cn } from "../../src/lib/utils.js";
import type { ManagePageData, UploadInventorySummary, UploadSummary } from "../../src/protected-data.js";
import { fetchPublisherRead, readPayload, waitForPublisher } from "./publisher-request.js";
import {
  ArtifactIcon,
  LifecycleBadge,
  TimeLeftBar,
  UrlBox,
  copyText,
  expiresWithinDay,
  formatBytes,
  lifecycle,
  relativeTime,
  shortUrl
} from "./artifact-parts.js";

type KindFilter = "all" | UploadSummary["kind"];
export type LifecycleFilter = "all" | "soon" | "temporary" | "permanent";
type SortOrder = "newest" | "oldest" | "filename" | "expiry";
type ProjectUsageGroup = {
  label: string;
  projects: Array<[string, number]>;
};

const ALL_PROJECTS = "__all__";
const UNASSIGNED_PROJECT = "__unassigned__";
const SORT_LABELS: Record<SortOrder, string> = { newest: "newest first", oldest: "oldest first", filename: "by name", expiry: "soonest expiry first" };

/** Below 1280 px the table needs the full width, so the inspector opens as a sheet. */
const COMPACT_QUERY = "(max-width: 1279px)";

function useCompactLayout() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(COMPACT_QUERY);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(COMPACT_QUERY).matches,
    () => false
  );
}

export function ManagePage({ initial }: { initial: ManagePageData }) {
  const compact = useCompactLayout();
  const [uploads, setUploads] = useState(initial.uploads);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [summary, setSummary] = useState<UploadInventorySummary>(() => initial.summary ?? summarizeLoaded(initial.uploads));
  const [selectedId, setSelectedId] = useState(initial.uploads[0]?.id);
  const [projectFilter, setProjectFilter] = useState(ALL_PROJECTS);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [lifecycleFilter, setLifecycleFilter] = useState<LifecycleFilter>("all");
  const [sort, setSort] = useState<SortOrder>("newest");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "success" | "error" }>();
  const [copiedId, setCopiedId] = useState<string>();
  const [sheetOpen, setSheetOpen] = useState(false);
  const replaceInput = useRef<HTMLInputElement>(null);
  const loadingAllRef = useRef(false);
  const [loadingAll, setLoadingAll] = useState(false);

  const projects = useMemo(() => summary.projects
    .map(({ project, count }) => [project ?? UNASSIGNED_PROJECT, count] as [string, number]), [summary]);
  const visibleUploads = useMemo(
    () => filterAndSortUploads(uploads, { projectFilter, query, kind, lifecycle: lifecycleFilter, sort }),
    [kind, lifecycleFilter, projectFilter, query, sort, uploads]
  );
  const selected = visibleUploads.find((upload) => upload.id === selectedId);
  const namedProjects = projects.filter(([project]) => project !== UNASSIGNED_PROJECT).length;

  async function refresh(options: { announce?: boolean } = {}) {
    setBusy(true);
    try {
      const response = await fetchPublisherRead("/api/external-uploads?limit=100&sort=newest&includeSummary=true", {
        credentials: "same-origin"
      });
      const payload = await readPayload<ManagePageData>(response, "The library could not be refreshed.");
      const refreshed = [...payload.uploads];
      setUploads(refreshed);
      setNextCursor(payload.nextCursor);
      if (payload.summary) setSummary(payload.summary);
      setSelectedId((current) => refreshed.some((upload) => upload.id === current)
        ? current
        : refreshed[0]?.id);
      if (options.announce) setMessage({ text: "The library is up to date.", tone: "success" });
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
      "The library counts could not be refreshed."
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
          "Older artifacts could not be loaded."
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
      const updated = await readPayload<UploadSummary>(response, "The file could not be replaced.");
      setUploads((current) => current.map((upload) => upload.id === updated.id ? updated : upload));
      setSelectedId(updated.id);
      setMessage({ text: `${updated.filename} replaced the plan. The link did not change.`, tone: "success" });
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
      await readPayload(response, "The project could not be changed.");
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
      const updated = await readPayload<{ expiresAt: string | null }>(response, "The file expiry could not be changed.");
      setUploads((current) => current.map((upload) => {
        if (upload.id !== selected.id) return upload;
        const { expiresAt: _oldExpiry, ...withoutExpiry } = upload;
        return updated.expiresAt ? { ...withoutExpiry, expiresAt: updated.expiresAt } : withoutExpiry;
      }));
      await refreshSummary();
      setMessage({
        text: updated.expiresAt
          ? `${selected.filename} now expires ${formatDateTime(updated.expiresAt)}.`
          : `${selected.filename} is now permanent. It stays until you revoke it.`,
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
      if (!response.ok) await readPayload(response, "The artifact could not be revoked.");
      const remaining = uploads.filter((upload) => upload.id !== selected.id);
      setUploads(remaining);
      setSelectedId(remaining[0]?.id);
      setSheetOpen(false);
      await refreshSummary();
      setMessage({ text: `${selected.filename} was revoked. Its link no longer works.`, tone: "success" });
    } catch (error) {
      setMessage({ text: errorMessage(error), tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function copyArtifactUrl(upload: UploadSummary) {
    if (await copyText(upload.url)) {
      setCopiedId(upload.id);
    } else {
      setMessage({ text: "The link could not be copied. Open the artifact and copy its address.", tone: "error" });
    }
  }

  function selectArtifact(id: string) {
    setSelectedId(id);
    if (compact) setSheetOpen(true);
  }

  function toggleLifecycle(filter: Exclude<LifecycleFilter, "all">) {
    setLifecycleFilter((current) => current === filter ? "all" : filter);
  }

  function sortBy(column: "filename" | "expiry" | "updated") {
    if (column === "updated") setSort((current) => current === "newest" ? "oldest" : "newest");
    else setSort(column);
  }

  const details = selected ? (
    <ArtifactDetails
      key={selected.id}
      upload={selected}
      busy={busy}
      copied={copiedId === selected.id}
      knownProjects={projects.map(([project]) => project).filter((project) => project !== UNASSIGNED_PROJECT)}
      replaceInput={replaceInput}
      onReplace={replaceSelected}
      onChangeProject={changeProject}
      onChangeExpiry={changeFileExpiry}
      onCopy={() => void copyArtifactUrl(selected)}
      onRevoke={revokeSelected}
    />
  ) : null;

  return (
    <>
      <AppShell product="Publisher" accent="violet" icon={favicons.publisher} />
      <main id="main" className="tools-page">
        <PageHeader
          title="Library"
          facts={`${countLabel(summary.total, "artifact")} in ${countLabel(namedProjects, "project")}`}
          actions={<>
            <Button type="button" variant="outline" size="icon-sm" aria-label="Refresh" disabled={busy} onClick={() => void refresh({ announce: true })}>
              <RefreshCw />
            </Button>
            <Button nativeButton={false} size="sm" render={<Link to="/publisher" preload="intent" />}>
              <Upload /> Publish
            </Button>
          </>}
        />

        {message ? <Alert className="mb-3" variant={message.tone === "error" ? "destructive" : "default"}>{message.text}</Alert> : null}

        <section className="mb-3 flex flex-wrap items-center gap-2" aria-label="Artifact filters">
          <label className="relative flex min-w-0 flex-[1_1_13.75rem] items-center max-md:basis-full md:max-w-80">
            <Search className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground" aria-hidden="true" />
            <Input className="pl-8" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search name, URL or project" aria-label="Search artifacts" />
          </label>
          <Segmented label="Artifact type" options={[["all", "All"], ["html", "Plans"], ["file", "Files"]]} value={kind} onValue={setKind} />
          <FilterChip label="Expiring soon" count={summary.expiringSoon} warning pressed={lifecycleFilter === "soon"} onClick={() => toggleLifecycle("soon")} />
          <FilterChip label="Temporary" count={summary.temporary} pressed={lifecycleFilter === "temporary"} onClick={() => toggleLifecycle("temporary")} />
          <FilterChip label="Permanent" count={summary.permanent} pressed={lifecycleFilter === "permanent"} onClick={() => toggleLifecycle("permanent")} />
          <ProjectSelect projects={projects} value={projectFilter} onValue={setProjectFilter} />
        </section>

        <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_19.5rem]">
          <ArtifactTable
            uploads={visibleUploads}
            total={summary.total}
            sort={sort}
            selectedId={selectedId}
            copiedId={copiedId}
            hasMore={Boolean(nextCursor)}
            busy={busy}
            loadingAll={loadingAll}
            onSort={sortBy}
            onSelect={selectArtifact}
            onCopy={(upload) => void copyArtifactUrl(upload)}
            onLoadMore={loadOlder}
            onSearchRemaining={loadCompleteLibrary}
          />
          {!compact ? (
            <Card className="sticky top-3 gap-0 py-0" aria-label="Artifact details">
              {details ?? <p className="grid min-h-48 place-items-center p-6 text-center text-[0.8125rem] text-muted-foreground">Select an artifact.</p>}
            </Card>
          ) : null}
        </div>
        {compact ? (
          <Sheet open={sheetOpen && Boolean(selected)} onOpenChange={setSheetOpen}>
            <SheetContent side="bottom" className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-2xl">
              <SheetTitle className="sr-only">Artifact details</SheetTitle>
              <span className="mx-auto mt-2 block h-1 w-9 shrink-0 rounded-full bg-border" aria-hidden="true" />
              {details}
            </SheetContent>
          </Sheet>
        ) : null}
      </main>
    </>
  );
}

function FilterChip({ label, count, pressed, warning = false, onClick }: { label: string; count: number; pressed: boolean; warning?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border border-control-border bg-control px-2.75 text-[0.8125rem] font-medium whitespace-nowrap transition-colors hover:border-control-border-hover aria-pressed:border-[color:var(--product-accent-border)] aria-pressed:bg-secondary aria-pressed:text-secondary-foreground"
    >
      {label}
      <b className={cn("font-semibold tabular-nums", warning && count > 0 && "text-warning")}>{count}</b>
    </button>
  );
}

function ProjectSelect({ projects, value, onValue }: { projects: Array<[string, number]>; value: string; onValue: (value: string) => void }) {
  const unassigned = projects.find(([project]) => project === UNASSIGNED_PROJECT)?.[1] ?? 0;
  return (
    <NativeSelect className="w-40" size="sm" value={value} onChange={(event) => onValue(event.currentTarget.value)} aria-label="Project">
      <NativeSelectOption value={ALL_PROJECTS}>All projects</NativeSelectOption>
      {groupProjectsByUsage(projects).map((group) => (
        <NativeSelectOptGroup key={group.label} label={group.label}>
          {group.projects.map(([project, count]) => <NativeSelectOption key={project} value={project}>{project} ({count})</NativeSelectOption>)}
        </NativeSelectOptGroup>
      ))}
      {unassigned ? <NativeSelectOption value={UNASSIGNED_PROJECT}>Unassigned ({unassigned})</NativeSelectOption> : null}
    </NativeSelect>
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

function SortHeader({ label, direction, onClick, className }: { label: string; direction?: "ascending" | "descending"; onClick: () => void; className?: string }) {
  const Icon = direction === "ascending" ? ChevronUp : ChevronDown;
  return (
    <TableHead className={className} aria-sort={direction ?? "none"}>
      <button type="button" className="inline-flex cursor-pointer items-center gap-1 hover:text-foreground" onClick={onClick}>
        {label}
        {direction ? <Icon className="size-3.5" aria-hidden="true" /> : null}
      </button>
    </TableHead>
  );
}

function ArtifactTable({ uploads, total, sort, selectedId, copiedId, hasMore, busy, loadingAll, onSort, onSelect, onCopy, onLoadMore, onSearchRemaining }: {
  uploads: UploadSummary[];
  total: number;
  sort: SortOrder;
  selectedId?: string;
  copiedId?: string;
  hasMore: boolean;
  busy: boolean;
  loadingAll: boolean;
  onSort: (column: "filename" | "expiry" | "updated") => void;
  onSelect: (id: string) => void;
  onCopy: (upload: UploadSummary) => void;
  onLoadMore: () => Promise<void>;
  onSearchRemaining: () => Promise<void>;
}) {
  const now = Date.now();
  const head = "h-auto px-2.5 py-1.75 text-xs font-medium text-muted-foreground";
  return (
    <Card className="gap-0 py-0" aria-label="Artifacts">
      {loadingAll ? <p className="border-b px-4 py-2 text-xs text-muted-foreground" role="status">Loading the full library, so search and filters include older artifacts.</p> : null}
      {uploads.length === 0 ? (
        <div className="grid min-h-60 place-items-center p-8 text-center">
          <div>
            <h2 className="text-sm font-semibold">{loadingAll ? "Searching the full library" : hasMore ? "No matches in loaded artifacts" : "No artifacts match"}</h2>
            <p className="mt-1 text-[0.8125rem] text-muted-foreground">{loadingAll ? "Older artifacts are still loading." : hasMore ? "Older artifacts are not searched yet." : "Try another search, type, project or filter."}</p>
          </div>
        </div>
      ) : (
        <Table className="text-[0.8125rem]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortHeader className={cn(head, "pl-4")} label="Artifact" direction={sort === "filename" ? "ascending" : undefined} onClick={() => onSort("filename")} />
              <TableHead className={cn(head, "max-md:hidden")}>Project</TableHead>
              <SortHeader className={cn(head, "max-md:hidden")} label="Lifecycle" direction={sort === "expiry" ? "ascending" : undefined} onClick={() => onSort("expiry")} />
              <SortHeader className={cn(head, "max-md:hidden")} label="Updated" direction={sort === "newest" ? "descending" : sort === "oldest" ? "ascending" : undefined} onClick={() => onSort("updated")} />
              <TableHead className={cn(head, "pr-4")}><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {uploads.map((upload) => {
              const state = lifecycle(upload, now);
              const isSelected = selectedId === upload.id;
              return (
                <TableRow
                  key={upload.id}
                  data-state={isSelected ? "selected" : undefined}
                  className="cursor-pointer border-border/60 data-[state=selected]:bg-[color-mix(in_oklab,var(--secondary)_55%,transparent)] data-[state=selected]:shadow-[inset_3px_0_var(--primary)]"
                  onClick={() => onSelect(upload.id)}
                >
                  <TableCell className="w-full max-w-0 py-2 pr-2.5 pl-4">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <ArtifactIcon kind={upload.kind} icon={upload.kind === "html" ? <FileCode /> : <File />} />
                      <button type="button" className="min-w-0 cursor-pointer text-left" aria-current={isSelected ? "true" : undefined}>
                        <span className="block truncate font-medium">{upload.filename}</span>
                        <span className="block truncate font-mono text-xs text-muted-foreground">{shortUrl(upload.url)}</span>
                        <span className="block truncate text-xs text-muted-foreground md:hidden">{upload.project ?? "Unassigned"} · {state.label}</span>
                      </button>
                    </span>
                  </TableCell>
                  <TableCell className="max-w-40 truncate px-2.5 max-md:hidden">{upload.project ?? <span className="text-muted-foreground">Unassigned</span>}</TableCell>
                  <TableCell className="px-2.5 max-md:hidden">
                    <span className={cn("block text-xs tabular-nums", state.tone === "warning" && "text-warning")}>{state.label}</span>
                    {state.fractionLeft !== undefined ? <TimeLeftBar fraction={state.fractionLeft} warning={state.tone === "warning"} /> : null}
                  </TableCell>
                  <TableCell className="px-2.5 text-muted-foreground max-md:hidden">{relativeTime(upload.updatedAt, now)}</TableCell>
                  <TableCell className="py-2 pr-4 pl-2.5 text-right">
                    <span className="inline-flex gap-0.5">
                      <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={`Copy link for ${upload.filename}`} onClick={(event) => { event.stopPropagation(); onCopy(upload); }}>
                        {copiedId === upload.id ? <Check /> : <Copy />}
                      </Button>
                      <Button className="text-muted-foreground max-md:hidden" nativeButton={false} variant="ghost" size="icon-sm" aria-label={`Open ${upload.filename}`} onClick={(event) => event.stopPropagation()} render={<a href={upload.url} target="_blank" rel="noreferrer" />}>
                        <ArrowUpRight />
                      </Button>
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5 text-[0.8125rem] text-muted-foreground">
        <span>{uploads.length} of {total} shown · {SORT_LABELS[sort]}</span>
        {hasMore ? (
          <span className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void onSearchRemaining()}>Search remaining artifacts</Button>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void onLoadMore()}>Load older</Button>
          </span>
        ) : null}
      </div>
    </Card>
  );
}

function ArtifactDetails({ upload, busy, copied, knownProjects, replaceInput, onReplace, onChangeProject, onChangeExpiry, onCopy, onRevoke }: {
  upload: UploadSummary;
  busy: boolean;
  copied: boolean;
  knownProjects: string[];
  replaceInput: RefObject<HTMLInputElement | null>;
  onReplace: (file: File) => Promise<void>;
  onChangeProject: (project: string) => Promise<void>;
  onChangeExpiry: (expiresAt: string | null) => Promise<boolean>;
  onCopy: () => void;
  onRevoke: () => Promise<void>;
}) {
  const [project, setProject] = useState(upload.project ?? "");
  const [expiryOpen, setExpiryOpen] = useState(false);
  const isPlan = upload.kind === "html";
  const projectChanged = project.trim().length > 0 && project.trim() !== (upload.project ?? "");
  const state = lifecycle(upload);
  return (
    <>
      <div className="border-b px-4 pt-3 pb-2.5">
        <LifecycleBadge upload={upload} accentPlans />
        <h2 className="mt-2 text-sm font-semibold [overflow-wrap:anywhere]">{upload.filename}</h2>
        <p className="mt-px text-xs text-muted-foreground">{formatBytes(upload.bytes)} · updated {relativeTime(upload.updatedAt)}</p>
      </div>
      <div className="grid gap-2.5 px-4 pt-2.5 pb-3.5">
        <UrlBox url={upload.url}>
          <Button type="button" size="sm" onClick={onCopy}>{copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}</Button>
        </UrlBox>
        <div className="flex flex-wrap gap-2">
          <Button nativeButton={false} variant="outline" size="sm" render={<a href={upload.url} target="_blank" rel="noreferrer" />}><ArrowUpRight /> Open</Button>
          {isPlan ? (
            <>
              <input ref={replaceInput} className="hidden" type="file" accept=".html,.htm,text/html,application/xhtml+xml" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void onReplace(file); }} aria-label="Choose a replacement HTML file" tabIndex={-1} />
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => replaceInput.current?.click()}><Upload /> Replace file</Button>
            </>
          ) : (
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setExpiryOpen(true)}>Change expiry</Button>
          )}
        </div>
        {isPlan ? (
          <div className="grid gap-1 text-[0.8125rem] text-muted-foreground">
            <label htmlFor="artifact-project">Project</label>
            <div className="flex gap-2">
              <Input id="artifact-project" className="h-8" list="artifact-projects" value={project} onChange={(event) => setProject(event.currentTarget.value)} placeholder="Project name" />
              <datalist id="artifact-projects">{knownProjects.map((value) => <option key={value} value={value} />)}</datalist>
              <Button type="button" variant="outline" size="sm" disabled={!projectChanged || busy} onClick={() => void onChangeProject(project.trim())}>Save</Button>
            </div>
          </div>
        ) : (
          <Detail label="Expiry">{upload.expiresAt ? `${state.label} · ${formatDateTime(upload.expiresAt)}` : "Permanent · until revoked"}</Detail>
        )}
        <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[0.8125rem]">
          <dt className="text-muted-foreground">Type</dt>
          <dd className="[overflow-wrap:anywhere]">{upload.contentType}</dd>
          <dt className="text-muted-foreground">Identifier</dt>
          <dd className="font-mono text-xs leading-5 break-all">{upload.id}</dd>
        </dl>
      </div>
      <div className="flex items-center justify-between gap-2.5 border-t px-4 py-3 text-[0.8125rem] text-muted-foreground">
        <span>The link stops working at once.</span>
        <AlertDialog>
          <AlertDialogTrigger render={<Button type="button" variant="destructive-subtle" size="sm" disabled={busy} />}><Trash2 /> Revoke…</AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke {upload.filename}?</AlertDialogTitle>
              <AlertDialogDescription>This deletes the stored file. People who open the link get a “not found” page.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => void onRevoke()}>Revoke artifact</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {!isPlan ? <FileExpiryDialog upload={upload} busy={busy} open={expiryOpen} onOpenChange={setExpiryOpen} onChange={onChangeExpiry} /> : null}
    </>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 text-[0.8125rem] text-muted-foreground">
      {label}
      <span className="text-foreground">{children}</span>
    </div>
  );
}

function FileExpiryDialog({ upload, busy, open, onOpenChange, onChange }: { upload: UploadSummary; busy: boolean; open: boolean; onOpenChange: (open: boolean) => void; onChange: (expiresAt: string | null) => Promise<boolean> }) {
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
    if (await onChange(permanent ? null : parsedExpiry.toISOString())) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Change file expiry</DialogTitle><DialogDescription>{upload.filename} {upload.expiresAt ? `expires ${formatDateTime(upload.expiresAt)}.` : "is permanent."}</DialogDescription></DialogHeader>
        <div className="flex items-center justify-between gap-4 rounded-lg border p-3"><div><label className="text-sm font-medium" htmlFor="file-permanent">Permanent</label><p className="mt-1 text-xs text-muted-foreground">Keep the file until you revoke it.</p></div><Switch id="file-permanent" checked={permanent} onCheckedChange={setPermanent} aria-label="Keep file permanently" /></div>
        <div className={permanent ? "pointer-events-none opacity-40" : ""} aria-disabled={permanent}>
          <p className="mb-2 text-xs font-medium">Keep from now</p>
          <div className="grid grid-cols-3 gap-2">{[1, 3, 7, 14, 30].map((days) => <Button key={days} type="button" variant="outline" size="sm" onClick={() => selectDuration(days)}>{countLabel(days, "day")}</Button>)}</div>
          <label className="mt-4 block text-xs font-medium" htmlFor="file-expiry">Exact expiry</label>
          <Input id="file-expiry" className="mt-2" type="datetime-local" value={expiry} min={formatDateTimeLocal(new Date())} onChange={(event) => { setPermanent(false); setExpiry(event.currentTarget.value); }} disabled={permanent} />
          <p className={`mt-2 text-xs ${validExpiry ? "text-muted-foreground" : "text-destructive"}`}>{validExpiry ? `New expiry: ${formatDateTime(parsedExpiry.toISOString())}` : "Choose a future date and time."}</p>
        </div>
        <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="button" disabled={busy || (!permanent && !validExpiry)} onClick={() => void save()}>{busy ? "Saving…" : "Change expiry"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function projectCounts(uploads: UploadSummary[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const upload of uploads) {
    const project = upload.project ?? UNASSIGNED_PROJECT;
    counts.set(project, (counts.get(project) ?? 0) + 1);
  }
  return [...counts];
}

function summarizeLoaded(uploads: UploadSummary[]): UploadInventorySummary {
  return {
    total: uploads.length,
    permanent: uploads.filter((upload) => !upload.expiresAt).length,
    temporary: uploads.filter((upload) => Boolean(upload.expiresAt)).length,
    expiringSoon: uploads.filter((upload) => expiresWithinDay(upload)).length,
    projects: projectCounts(uploads).map(([project, count]) => ({
      project: project === UNASSIGNED_PROJECT ? null : project,
      count
    }))
  };
}

/** Filters the loaded artifacts. The lifecycle filters match the counted chips: permanent means no expiry, which includes plans. */
export function filterAndSortUploads(
  uploads: UploadSummary[],
  filters: { projectFilter: string; query: string; kind: KindFilter; lifecycle: LifecycleFilter; sort: SortOrder },
  now = Date.now()
) {
  const query = filters.query.trim().toLocaleLowerCase();
  return uploads.filter((upload) => {
    const project = upload.project ?? UNASSIGNED_PROJECT;
    if (filters.projectFilter !== ALL_PROJECTS && project !== filters.projectFilter) return false;
    if (filters.kind !== "all" && upload.kind !== filters.kind) return false;
    if (query && !`${upload.filename} ${upload.url} ${upload.project ?? ""}`.toLocaleLowerCase().includes(query)) return false;
    if (filters.lifecycle === "permanent" && upload.expiresAt) return false;
    if (filters.lifecycle === "temporary" && !upload.expiresAt) return false;
    if (filters.lifecycle === "soon" && !expiresWithinDay(upload, now)) return false;
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The artifact operation failed.";
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function formatDateTimeLocal(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

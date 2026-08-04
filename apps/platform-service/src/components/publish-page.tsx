import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { AppShell } from "./app-shell.js";
import { AppSelect } from "./form-controls.js";
import { Alert } from "./ui/alert.js";
import { Badge } from "./ui/badge.js";
import { Button } from "./ui/button.js";
import { Card } from "./ui/card.js";
import { Input } from "./ui/input.js";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs.js";
import type { UploadPageData, UploadSummary } from "../protected-data.js";

type UploadFilter = "all" | "html" | "file";
type ExpiryFilter = "all" | "24h" | "7d" | "persistent";
type SortOrder = "newest" | "oldest" | "filename" | "expiry";

export function PublishPage({ initial }: { initial: UploadPageData }) {
  const [uploads, setUploads] = useState(initial.uploads);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [filter, setFilter] = useState<UploadFilter>("all");
  const [expiry, setExpiry] = useState<ExpiryFilter>("all");
  const [sort, setSort] = useState<SortOrder>("newest");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "success" | "error" }>();
  const fileInput = useRef<HTMLInputElement>(null);
  const firstCriteriaRequest = useRef(true);

  useEffect(() => {
    if (firstCriteriaRequest.current) {
      firstCriteriaRequest.current = false;
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetchUploads({ filter, expiry, sort, search }, controller.signal)
        .then((payload) => {
          setUploads(payload.uploads);
          setNextCursor(payload.nextCursor);
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setMessage({ text: error instanceof Error ? error.message : "The upload inventory could not be filtered.", tone: "error" });
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [expiry, filter, search, sort]);

  async function uploadFile(file: File) {
    setBusy(true);
    setMessage(undefined);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/external-uploads", {
        method: "POST",
        credentials: "same-origin",
        body: form
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.message === "string" ? payload.message : `Upload failed (HTTP ${response.status}).`);
      const uploaded = payload as UploadSummary & { sha256?: string };
      const refreshed = await fetchUploads({ filter, expiry, sort, search });
      setUploads(refreshed.uploads);
      setNextCursor(refreshed.nextCursor);
      setMessage({ text: `${uploaded.filename} is ready to share.`, tone: "success" });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "The upload failed.", tone: "error" });
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (file) void uploadFile(file);
  }

  function dropFile(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void uploadFile(file);
  }

  async function refresh() {
    setBusy(true);
    try {
      const payload = await fetchUploads({ filter, expiry, sort, search });
      setUploads(payload.uploads);
      setNextCursor(payload.nextCursor);
      setMessage({ text: "Recent uploads refreshed.", tone: "success" });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "The upload inventory could not be refreshed.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function loadMore() {
    if (!nextCursor) return;
    setBusy(true);
    try {
      const payload = await fetchUploads({ filter, expiry, sort, search }, undefined, nextCursor);
      setUploads((current) => [...current, ...payload.uploads]);
      setNextCursor(payload.nextCursor);
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Older uploads could not be loaded.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AppShell active="publish" />
      <main id="main" className="mx-auto w-[min(1180px,calc(100%_-_2rem))] py-8 sm:py-10">
        <section className="mb-6 flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between" aria-labelledby="publish-title">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Artifact publisher</p>
            <h1 id="publish-title" className="mt-2 text-3xl font-semibold tracking-tight">Share a new artifact.</h1>
            <p className="mt-2 text-sm text-muted-foreground">Files are private until their generated link is shared.</p>
          </div>
          <Badge variant="default">Publisher online</Badge>
        </section>

        {message ? <Alert className="mb-4" variant={message.tone === "error" ? "destructive" : "default"} data-tone={message.tone}>{message.text}</Alert> : null}

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(16rem,.5fr)]" aria-label="Upload workspace">
          <Card className={`grid min-h-64 place-items-center border-dashed text-center transition-colors ${dragging ? "border-foreground bg-secondary" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={dropFile}>
            <div className="max-w-md p-6">
              <div className="mx-auto mb-4 grid size-10 place-items-center rounded-full border text-lg" aria-hidden="true">↑</div>
              <strong className="text-lg">{busy ? "Uploading…" : "Drop a file here"}</strong>
              <p className="mt-2 text-sm text-muted-foreground">HTML plans become previewable artifacts. Other files remain downloads.</p>
              <Input className="sr-only" ref={fileInput} type="file" onChange={chooseFile} aria-label="Choose a file to upload" />
              <Button type="button" variant="default" size="sm" onClick={() => fileInput.current?.click()} disabled={busy}>
                {busy ? "Working…" : "Choose file"}
              </Button>
            </div>
          </Card>
          <aside className="rounded-lg border bg-card p-5" aria-label="Upload policy">
            <h2 className="font-semibold">Upload policy</h2>
            <p className="mt-2 text-sm text-muted-foreground">Generated URLs are unlisted capability links. Temporary uploads expire automatically.</p>
            <dl className="mt-5 grid gap-3 text-xs">
              <div><dt className="text-muted-foreground">Delivery</dt><dd className="mt-1 font-medium">Preview or download</dd></div>
              <div><dt className="text-muted-foreground">Access</dt><dd className="mt-1 font-medium">Unlisted URL</dd></div>
              <div><dt className="text-muted-foreground">Inventory</dt><dd className="mt-1 font-medium">{uploads.length} loaded</dd></div>
            </dl>
          </aside>
        </section>

        <section className="mt-8 overflow-hidden rounded-lg border" aria-labelledby="recent-uploads-title">
          <div className="flex items-end justify-between gap-3 border-b p-5">
            <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Shared bucket</p><h2 className="mt-1 font-semibold" id="recent-uploads-title">Recent uploads</h2></div>
            <Button type="button" variant="ghost" size="sm" onClick={() => void refresh()} disabled={busy}>↻ Refresh</Button>
          </div>
          <Tabs className="grid gap-2 border-b p-3 lg:grid-cols-[auto_minmax(12rem,1fr)_11rem_10rem]" value={filter} onValueChange={(value) => setFilter(value as UploadFilter)}>
            <TabsList>
              {(["all", "html", "file"] as const).map((value) => <TabsTrigger key={value} value={value}>{value === "all" ? "All" : value === "html" ? "Plans" : "Files"}</TabsTrigger>)}
            </TabsList>
            <Input value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Search filenames" aria-label="Search filenames" />
            <AppSelect value={expiry} onValueChange={(value) => setExpiry(value as ExpiryFilter)} aria-label="Filter by expiry" options={[{ value: "all", label: "All expiry" }, { value: "24h", label: "Next 24 hours" }, { value: "7d", label: "Next 7 days" }, { value: "persistent", label: "Persistent" }]} />
            <AppSelect value={sort} onValueChange={(value) => setSort(value as SortOrder)} aria-label="Sort uploads" options={[{ value: "newest", label: "Newest" }, { value: "oldest", label: "Oldest" }, { value: "filename", label: "Filename" }, { value: "expiry", label: "Expiry" }]} />
          </Tabs>
          <div>
            {uploads.length === 0 ? <div className="grid min-h-52 place-items-center p-8 text-center"><div><h2 className="font-semibold">No uploads match</h2><p className="mt-1 text-sm text-muted-foreground">Try another filter or upload a new artifact.</p></div></div> : uploads.map((upload) => <UploadRow key={upload.id} upload={upload} onMessage={setMessage} />)}
            {nextCursor ? <div className="flex justify-center border-t p-3"><Button type="button" variant="ghost" disabled={busy} onClick={() => void loadMore()}>Load older uploads</Button></div> : null}
          </div>
        </section>
      </main>
    </>
  );
}

type UploadCriteria = { filter: UploadFilter; expiry: ExpiryFilter; sort: SortOrder; search: string };

export function uploadListUrl(criteria: UploadCriteria, cursor?: string) {
  const query = new URLSearchParams({
    limit: "25",
    kind: criteria.filter,
    expiry: criteria.expiry,
    sort: criteria.sort
  });
  const search = criteria.search.trim();
  if (search) query.set("q", search);
  if (cursor) query.set("cursor", cursor);
  return `/api/external-uploads?${query}`;
}

async function fetchUploads(criteria: UploadCriteria, signal?: AbortSignal, cursor?: string) {
  const response = await fetch(uploadListUrl(criteria, cursor), { credentials: "same-origin", signal });
  if (!response.ok) throw new Error(`Upload inventory request failed (HTTP ${response.status}).`);
  return response.json() as Promise<UploadPageData>;
}

function UploadRow({ upload, onMessage }: { upload: UploadSummary; onMessage: (message: { text: string; tone: "success" | "error" }) => void }) {
  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(upload.url);
      onMessage({ text: "Link copied to the clipboard.", tone: "success" });
    } catch {
      onMessage({ text: "The link could not be copied. Open it to copy manually.", tone: "error" });
    }
  }
  return (
    <div className="grid gap-3 border-b p-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
      <div className="flex min-w-0 items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-md border text-muted-foreground" aria-hidden="true">{upload.kind === "html" ? "▤" : "⇩"}</span><div className="min-w-0"><strong className="block truncate text-sm">{upload.filename}</strong><small className="text-xs text-muted-foreground">{upload.kind === "html" ? "Plan" : "File"} · {formatBytes(upload.bytes)}{upload.expiresAt ? ` · expires ${formatDate(upload.expiresAt)}` : " · persistent"}</small></div></div>
      <time className="text-xs text-muted-foreground" dateTime={upload.updatedAt}>Uploaded {formatDate(upload.updatedAt)}</time>
      <div className="flex justify-end gap-1"><Button type="button" variant="ghost" size="sm" onClick={() => void copyUrl()}>Copy</Button><Button nativeButton={false} variant="secondary" size="sm" render={<a href={upload.url} target="_blank" rel="noreferrer" />}>Open ↗</Button></div>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) + " UTC";
}

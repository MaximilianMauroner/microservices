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
      <main id="main" className="app-page">
        <section className="app-heading" aria-labelledby="publish-title">
          <div>
            <p className="eyebrow">Artifact publisher</p>
            <h1 id="publish-title">Upload a durable artifact.</h1>
            <p>Files are private until their generated link is shared.</p>
          </div>
          <div className="app-heading__actions">
            <Badge variant="default">Publisher online</Badge>
          </div>
        </section>

        {message ? <Alert variant={message.tone === "error" ? "destructive" : "default"} data-tone={message.tone}>{message.text}</Alert> : null}

        <section className="publish-layout" aria-label="Upload workspace">
          <Card className={`publish-dropzone${dragging ? " is-dragging" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={dropFile}>
            <div>
              <div className="publish-icon" aria-hidden="true">↑</div>
              <strong>{busy ? "Uploading…" : "Drop a file here"}</strong>
              <p>HTML plans become previewable artifacts. Other files remain downloads.</p>
              <Input ref={fileInput} type="file" onChange={chooseFile} aria-label="Choose a file to upload" />
              <Button type="button" variant="default" size="sm" onClick={() => fileInput.current?.click()} disabled={busy}>
                {busy ? "Working…" : "Choose file"}
              </Button>
            </div>
          </Card>
          <aside className="publish-policy" aria-label="Upload policy">
            <h2>Upload policy</h2>
            <p>Generated URLs are unlisted capability links. Temporary uploads expire automatically.</p>
            <dl>
              <dt>Delivery</dt><dd>Preview or download</dd>
              <dt>Access</dt><dd>Unlisted URL</dd>
              <dt>Inventory</dt><dd>{uploads.length} loaded</dd>
            </dl>
          </aside>
        </section>

        <section className="publish-list" aria-labelledby="recent-uploads-title">
          <div className="publish-list__heading">
            <div><p className="eyebrow">Shared bucket</p><h2 id="recent-uploads-title">Recent uploads</h2></div>
            <Button type="button" variant="ghost" size="sm" onClick={() => void refresh()} disabled={busy}>↻ Refresh</Button>
          </div>
          <Tabs className="publish-filters" value={filter} onValueChange={(value) => setFilter(value as UploadFilter)}>
            <TabsList>
              {(["all", "html", "file"] as const).map((value) => <TabsTrigger key={value} value={value}>{value === "all" ? "All" : value === "html" ? "Plans" : "Files"}</TabsTrigger>)}
            </TabsList>
            <Input value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Search filenames" aria-label="Search filenames" />
            <AppSelect value={expiry} onValueChange={(value) => setExpiry(value as ExpiryFilter)} aria-label="Filter by expiry" options={[{ value: "all", label: "All expiry" }, { value: "24h", label: "Next 24 hours" }, { value: "7d", label: "Next 7 days" }, { value: "persistent", label: "Persistent" }]} />
            <AppSelect value={sort} onValueChange={(value) => setSort(value as SortOrder)} aria-label="Sort uploads" options={[{ value: "newest", label: "Newest" }, { value: "oldest", label: "Oldest" }, { value: "filename", label: "Filename" }, { value: "expiry", label: "Expiry" }]} />
          </Tabs>
          <div className="app-card publish-list__body">
            {uploads.length === 0 ? <div className="app-empty"><h2>No uploads match</h2><p>Try another filter or upload a new artifact.</p></div> : uploads.map((upload) => <UploadRow key={upload.id} upload={upload} onMessage={setMessage} />)}
            {nextCursor ? <div className="review-actions"><Button type="button" variant="ghost" disabled={busy} onClick={() => void loadMore()}>Load older uploads</Button></div> : null}
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
    <div className="upload-row">
      <div className="upload-row__identity"><span className="upload-row__icon" aria-hidden="true">{upload.kind === "html" ? "▤" : "⇩"}</span><div><strong>{upload.filename}</strong><small>{upload.kind === "html" ? "Plan" : "File"} · {formatBytes(upload.bytes)}</small></div></div>
      <time className="upload-row__date" dateTime={upload.updatedAt}>Uploaded {formatDate(upload.updatedAt)}</time>
      <div className="upload-row__actions"><Button type="button" variant="ghost" size="sm" onClick={() => void copyUrl()}>Copy</Button><Button variant="secondary" size="sm" render={<a href={upload.url} target="_blank" rel="noreferrer" />}>Open ↗</Button></div>
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

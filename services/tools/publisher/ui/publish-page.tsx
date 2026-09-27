import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Check, Copy, ExternalLink, FolderOpen, RotateCcw, Upload, X } from "lucide-react";
import { AppShell } from "../../src/components/app-shell.js";
import { favicons } from "../../src/favicons.js";
import { Alert } from "../../src/components/ui/alert.js";
import { Badge } from "../../src/components/ui/badge.js";
import { Button } from "../../src/components/ui/button.js";
import { Card } from "../../src/components/ui/card.js";
import { Input } from "../../src/components/ui/input.js";
import type { UploadSummary } from "../../src/protected-data.js";
import { fetchPublisherRead, waitForPublisher } from "./publisher-request.js";
import {
  UploadCancelledError,
  friendlyUploadError,
  parseErrorPayload,
  shouldUseChunkedUpload,
  uploadChunkedFile
} from "./chunked-upload.js";
import { PageHeader } from "../../src/components/page-header.js";
import { formatDateTime } from "../../src/lib/format-date.js";

type ItemStatus = "queued" | "checking" | "uploading" | "processing" | "done" | "error" | "cancelled";

type UploadItem = {
  key: string;
  name: string;
  size: number;
  loaded: number;
  percent: number;
  status: ItemStatus;
  note: string;
  error?: string;
};

function isAbortError(error: unknown, signal?: AbortSignal | null) {
  if (signal?.aborted) return true;
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function uploadExternalFile(
  file: File,
  onProgress: (loaded: number, total: number, lengthComputable: boolean) => void,
  onProcessing: () => void,
  registerXhr: (xhr: XMLHttpRequest | null) => void,
  options: { persistentHtml: boolean; project: string }
): Promise<UploadSummary> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    registerXhr(xhr);
    xhr.upload.addEventListener("progress", (event) => {
      onProgress(event.loaded, event.total, event.lengthComputable);
    });
    xhr.upload.addEventListener("load", () => {
      onProcessing();
    });
    xhr.addEventListener("load", () => {
      registerXhr(null);
      const payload = parseErrorPayload(xhr.responseText) as (UploadSummary & { message?: string }) | undefined;
      if (xhr.status >= 200 && xhr.status < 300 && payload && "url" in payload && typeof payload.url === "string") {
        resolve(payload as UploadSummary);
        return;
      }
      reject(new Error(friendlyUploadError(xhr.status, payload?.message)));
    });
    xhr.addEventListener("error", () => {
      registerXhr(null);
      reject(new Error("The connection was interrupted. Check your network, then retry."));
    });
    xhr.addEventListener("abort", () => {
      registerXhr(null);
      reject(new UploadCancelledError());
    });
    xhr.addEventListener("timeout", () => {
      registerXhr(null);
      reject(new Error("The upload timed out. Try again with a smaller file or better connection."));
    });
    xhr.open("POST", options.persistentHtml ? "/api/browser-html-uploads" : "/api/external-uploads");
    xhr.setRequestHeader("Accept", "application/json");
    xhr.withCredentials = true;
    const form = new FormData();
    form.append("file", file);
    if (options.persistentHtml && options.project.trim()) form.append("project", options.project.trim());
    xhr.send(form);
  });
}

function statusBadgeVariant(status: ItemStatus): "positive" | "secondary" | "destructive" | "outline" {
  if (status === "error") return "destructive";
  if (status === "done") return "positive";
  if (status === "uploading" || status === "checking" || status === "processing") return "secondary";
  return "outline";
}

function statusLabel(item: UploadItem) {
  if (item.status === "queued") return "Queued";
  if (item.status === "checking") return "Checking…";
  if (item.status === "uploading") return `Uploading… ${item.percent}%`;
  if (item.status === "processing") return "Processing…";
  if (item.status === "done") return "Ready";
  if (item.status === "error") return "Failed";
  return "Cancelled";
}

export function PublishPage() {
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [results, setResults] = useState<UploadSummary[]>([]);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [message, setMessage] = useState<{ text: string; tone: "success" | "error" }>();
  const [fileExpiry, setFileExpiry] = useState<"1" | "3" | "7" | "30" | "permanent">("3");
  const [htmlProject, setHtmlProject] = useState("");
  const expiryWarning = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const activeXhr = useRef<XMLHttpRequest | null>(null);
  const abortController = useRef<AbortController | null>(null);
  const cancelRequested = useRef(false);
  const fileByKey = useRef(new Map<string, File>());

  useEffect(() => {
    return () => {
      cancelRequested.current = true;
      abortController.current?.abort();
      activeXhr.current?.abort();
    };
  }, []);

  function updateItem(key: string, patch: Partial<UploadItem>) {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  async function uploadOne(key: string, file: File) {
    const signal = abortController.current?.signal;
    updateItem(key, { status: "checking", percent: 0, loaded: 0, error: undefined, note: "Checking publisher health…" });
    try {
      await waitForPublisher(undefined, globalThis.fetch, signal);
    } catch (error) {
      if (error instanceof UploadCancelledError || isAbortError(error, signal) || cancelRequested.current) {
        updateItem(key, { status: "cancelled", note: "Cancelled before upload started." });
        return { outcome: "cancelled" as const };
      }
      const reason = error instanceof Error ? error.message : "Publisher check failed.";
      updateItem(key, { status: "error", error: reason, note: "Publisher check failed." });
      return { outcome: "error" as const, reason };
    }

    if (cancelRequested.current) {
      updateItem(key, { status: "cancelled", note: "Cancelled before upload started." });
      return { outcome: "cancelled" as const };
    }

    updateItem(key, { status: "uploading", percent: 0, loaded: 0, note: `Sending ${formatBytes(0)} of ${formatBytes(file.size)}` });
    try {
      const onProcessing = () => {
        updateItem(key, { status: "processing", loaded: file.size, percent: 100, note: "Finalizing on server…" });
      };
      const registerXhr = (xhr: XMLHttpRequest | null) => {
        activeXhr.current = xhr;
      };
      const htmlPlan = /\.html?$/i.test(file.name);
      const htmlFile = htmlPlan && file.type !== "text/html" ? new File([file], file.name, { type: "text/html" }) : file;
      let payload = !htmlPlan && shouldUseChunkedUpload(file.size)
        ? await uploadChunkedFile(
            htmlFile,
            {
              onProgress: (loaded, total) => {
                const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
                updateItem(key, {
                  status: "uploading",
                  loaded,
                  percent,
                  note: `Sending ${formatBytes(loaded)} of ${formatBytes(total)} in small requests`
                });
              },
              onProcessing,
              registerXhr,
              isCancelled: () => cancelRequested.current
            }
          )
        : await uploadExternalFile(
            htmlFile,
            (loaded, total, lengthComputable) => {
              const totalBytes = lengthComputable && total > 0 ? total : file.size;
              const percent = totalBytes > 0 ? Math.min(100, Math.round((loaded / totalBytes) * 100)) : 0;
              updateItem(key, {
                status: "uploading",
                loaded: Math.min(loaded, Math.max(totalBytes, file.size)),
                percent,
                note: `Sending ${formatBytes(Math.min(loaded, Math.max(totalBytes, file.size)))} of ${formatBytes(file.size)}`
              });
            },
            onProcessing,
            registerXhr,
            { persistentHtml: htmlPlan, project: htmlProject }
          );
      let expiryApplied = true;
      if (!htmlPlan && fileExpiry !== "3") {
        try {
          const expiresAt = fileExpiry === "permanent" ? null : new Date(Date.now() + Number(fileExpiry) * 86_400_000).toISOString();
          const response = await fetch(`/api/external-uploads/${payload.id}`, { method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expiresAt }) });
          if (!response.ok) throw new Error("The selected expiry could not be applied.");
          const { expiresAt: _previous, ...withoutExpiry } = payload;
          payload = expiresAt ? { ...withoutExpiry, expiresAt } : withoutExpiry;
        } catch {
          expiryWarning.current = true;
          expiryApplied = false;
          updateItem(key, { note: "Uploaded, but the selected expiry was not applied. Check Library." });
        }
      }
      updateItem(key, { status: "done", loaded: file.size, percent: 100, ...(expiryApplied ? { note: "Uploaded." } : {}) });
      setResults((current) => [...current, payload]);
      return { outcome: "done" as const, payload };
    } catch (error) {
      if (error instanceof UploadCancelledError || isAbortError(error, signal) || cancelRequested.current) {
        updateItem(key, { status: "cancelled", note: "Cancelled." });
        return { outcome: "cancelled" as const };
      }
      const reason = error instanceof Error ? error.message : "The upload failed.";
      updateItem(key, { status: "error", error: reason, note: "Failed." });
      return { outcome: "error" as const, reason };
    }
  }

  function summarizeAndFinish(succeeded: number, failed: number, cancelled: number, total: number) {
    if (expiryWarning.current) { setMessage({ text: "Some files uploaded, but their selected expiry could not be applied. Check and correct them in Library.", tone: "error" }); expiryWarning.current = false; return; }
    if (failed === 0 && cancelled === 0) {
      setMessage({
        text: total === 1 ? "File is ready to share." : `${total} files are ready to share.`,
        tone: "success"
      });
      return;
    }
    if (succeeded === 0 && failed > 0 && cancelled === 0) {
      setMessage({
        text: failed === 1 ? "Upload failed. See details below." : `${failed} uploads failed. See details below.`,
        tone: "error"
      });
      return;
    }
    if (cancelRequested.current && succeeded === 0 && failed === 0) {
      setMessage({ text: "Upload cancelled.", tone: "success" });
      return;
    }
    const parts: string[] = [];
    if (succeeded > 0) parts.push(`${succeeded} uploaded`);
    if (failed > 0) parts.push(`${failed} failed`);
    if (cancelled > 0) parts.push(`${cancelled} cancelled`);
    setMessage({ text: `${parts.join(", ")}. See details below.`, tone: failed > 0 ? "error" : "success" });
  }

  async function startUpload(files: File[]) {
    if (files.length === 0 || busy) return;
    cancelRequested.current = false;
    abortController.current?.abort();
    abortController.current = new AbortController();
    fileByKey.current.clear();
    const now = Date.now();
    const nextItems: UploadItem[] = files.map((file, index) => {
      const key = `${now}-${index}-${file.size}-${file.name}`;
      fileByKey.current.set(key, file);
      return {
        key,
        name: file.name,
        size: file.size,
        loaded: 0,
        percent: 0,
        status: "queued" as const,
        note: "Waiting to start"
      };
    });
    setBusy(true);
    setResults([]);
    setItems(nextItems);
    setMessage(undefined);

    let succeeded = 0;
    let failed = 0;
    let cancelled = 0;
    try {
      for (const item of nextItems) {
        if (cancelRequested.current) {
          updateItem(item.key, { status: "cancelled", note: "Cancelled before upload started." });
          cancelled += 1;
          continue;
        }
        const file = fileByKey.current.get(item.key);
        if (!file) {
          updateItem(item.key, { status: "error", error: "File reference lost.", note: "Failed." });
          failed += 1;
          continue;
        }
        const result = await uploadOne(item.key, file);
        if (result.outcome === "done") succeeded += 1;
        else if (result.outcome === "error") failed += 1;
        else cancelled += 1;
        if (cancelRequested.current) {
          // Mark any remaining queued items as cancelled without attempting them.
          const currentIndex = nextItems.findIndex((candidate) => candidate.key === item.key);
          for (const remaining of nextItems.slice(currentIndex + 1)) {
            updateItem(remaining.key, { status: "cancelled", note: "Cancelled before upload started." });
            cancelled += 1;
          }
          break;
        }
      }
      summarizeAndFinish(succeeded, failed, cancelled, nextItems.length);
    } finally {
      setBusy(false);
      activeXhr.current = null;
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function retryKeys(keys: string[]) {
    if (keys.length === 0 || busy) return;
    const retryFiles = keys
      .map((key) => ({ key, file: fileByKey.current.get(key) }))
      .filter((entry): entry is { key: string; file: File } => Boolean(entry.file));
    if (retryFiles.length === 0) return;
    cancelRequested.current = false;
    abortController.current?.abort();
    abortController.current = new AbortController();
    setBusy(true);
    setMessage(undefined);
    for (const { key } of retryFiles) {
      updateItem(key, { status: "queued", loaded: 0, percent: 0, error: undefined, note: "Waiting to start" });
    }

    let succeeded = 0;
    let failed = 0;
    let cancelled = 0;
    try {
      for (const { key, file } of retryFiles) {
        if (cancelRequested.current) {
          updateItem(key, { status: "cancelled", note: "Cancelled before retry started." });
          cancelled += 1;
          continue;
        }
        const result = await uploadOne(key, file);
        if (result.outcome === "done") succeeded += 1;
        else if (result.outcome === "error") failed += 1;
        else cancelled += 1;
      }
      setItems((current) => {
        const done = current.filter((item) => item.status === "done").length;
        const errors = current.filter((item) => item.status === "error").length;
        const cancels = current.filter((item) => item.status === "cancelled").length;
        if (errors === 0 && cancels === 0) {
          setMessage({ text: done === 1 ? "File is ready to share." : `${done} files are ready to share.`, tone: "success" });
        } else {
          const parts: string[] = [];
          if (done > 0) parts.push(`${done} uploaded`);
          if (errors > 0) parts.push(`${errors} failed`);
          if (cancels > 0) parts.push(`${cancels} cancelled`);
          setMessage({ text: `${parts.join(", ")}. See details below.`, tone: errors > 0 ? "error" : "success" });
        }
        return current;
      });
      void succeeded;
      void failed;
      void cancelled;
    } finally {
      setBusy(false);
      activeXhr.current = null;
    }
  }

  function cancelUploads() {
    cancelRequested.current = true;
    abortController.current?.abort();
    activeXhr.current?.abort();
  }

  function clearUploads() {
    if (busy) return;
    setItems([]);
    setMessage(undefined);
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    void startUpload(Array.from(event.currentTarget.files ?? []));
  }

  function dropFile(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void startUpload(Array.from(event.dataTransfer.files));
  }

  async function copyResultUrls(selected: UploadSummary[]) {
    if (selected.length === 0) return;
    try {
      await navigator.clipboard.writeText(capabilityUrlText(selected));
      setMessage({ text: selected.length === 1 ? "Capability URL copied." : `${selected.length} capability URLs copied.`, tone: "success" });
    } catch {
      setMessage({ text: "The URLs could not be copied. Open the uploads to copy them manually.", tone: "error" });
    }
  }

  const hasItems = items.length > 0;
  const failures = items.filter((item) => item.status === "error");
  const totalBytes = items.reduce((sum, item) => sum + item.size, 0);
  const loadedBytes = items.reduce((sum, item) => {
    if (item.status === "done") return sum + item.size;
    return sum + Math.min(item.loaded, Math.max(item.size, 0));
  }, 0);
  const overallPercent = totalBytes > 0 ? Math.min(100, Math.round((loadedBytes / totalBytes) * 100)) : hasItems ? 100 : 0;
  const completedCount = items.filter((item) => item.status === "done" || item.status === "error" || item.status === "cancelled").length;
  const title = !hasItems
    ? "Drop files here"
    : busy
      ? `Uploading ${Math.min(completedCount + 1, items.length)} of ${items.length}…`
      : failures.length > 0
        ? "Upload finished with issues"
        : items.some((item) => item.status === "cancelled")
          ? "Upload cancelled"
          : "Upload complete";

  return (
    <>
      <AppShell product="Publisher" accent="violet" icon={favicons.publisher} />
      <main id="main" className="tools-page">
        <PageHeader title="Publish" facts="Drop a file to get an unlisted link. HTML plans stay until revoked; other files expire." actions={<Button nativeButton={false} variant="outline" size="sm" render={<Link to="/publisher/artifacts" preload="intent" />}>
            <FolderOpen /> Manage artifacts
          </Button>} />

        {message ? <Alert className="mb-4" variant={message.tone === "error" ? "destructive" : "default"}>{message.text}</Alert> : null}

        <section className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(16rem,.7fr)]" aria-label="Upload workspace">
          <div className="grid gap-3">
          <Card className={`text-center transition-colors ${dragging ? "border-foreground bg-secondary" : ""} ${hasItems ? "place-items-stretch p-6 text-left" : "grid min-h-72 place-items-center border border-dashed"}`} onDragEnter={(event) => { event.preventDefault(); if (!busy) setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={dropFile}>
            {!hasItems ? (
              <div className="max-w-md p-6">
                <div className="mx-auto mb-4 grid size-11 place-items-center rounded-full border text-muted-foreground" aria-hidden="true"><Upload /></div>
                <strong className="text-lg">Drop files here</strong>
                <p className="mt-2 text-sm text-muted-foreground">HTML plans stay until revoked. Other files use the expiry selected below. Anyone with the link can open it.</p>
                <Input className="hidden" ref={fileInput} type="file" multiple onChange={chooseFile} aria-label="Choose files to upload" tabIndex={-1} />
                <Button className="mt-5" type="button" size="sm" onClick={() => fileInput.current?.click()} disabled={busy}>
                  {busy ? "Working…" : "Choose files"}
                </Button>
              </div>
            ) : (
              <div className="w-full" aria-live="polite">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <strong className="text-lg">{title}</strong>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {completedCount} of {items.length} files finished · {formatBytes(loadedBytes)} of {formatBytes(totalBytes)} · {overallPercent}%
                    </p>
                  </div>
                  <div className="grid size-11 shrink-0 place-items-center rounded-full border text-muted-foreground" aria-hidden="true"><Upload /></div>
                </div>

                <div
                  className="mt-4"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={overallPercent}
                  aria-label="Overall upload progress"
                >
                  <div className="relative flex h-1.5 w-full items-center overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary transition-all" style={{ width: `${overallPercent}%` }} />
                  </div>
                </div>

                <ul className="mt-4 grid gap-2" aria-label="Upload progress">
                  {items.map((item) => (
                    <li key={item.key} className="rounded-lg border p-3 text-left">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-sm font-medium" title={item.name}>{item.name}</span>
                        <Badge variant={statusBadgeVariant(item.status)}>{statusLabel(item)}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatBytes(item.size)} · {item.note}
                      </p>
                      <div
                        className="mt-2"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={item.percent}
                        aria-label={`Upload progress for ${item.name}`}
                      >
                        <div className="relative flex h-1.5 w-full items-center overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full transition-all ${item.status === "error" ? "bg-destructive" : "bg-primary"}`}
                            style={{ width: `${Math.min(100, Math.max(0, item.percent))}%` }}
                          />
                        </div>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                        <span>{item.percent}%</span>
                        <span>{formatBytes(Math.min(item.loaded, Math.max(item.size, item.loaded)))} of {formatBytes(item.size)}</span>
                      </div>
                      {item.error ? <p role="alert" className="mt-2 text-xs text-destructive">{item.error}</p> : null}
                    </li>
                  ))}
                </ul>

                <Input className="hidden" ref={fileInput} type="file" multiple onChange={chooseFile} aria-label="Choose files to upload" tabIndex={-1} />
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={() => fileInput.current?.click()} disabled={busy}>
                    Choose files
                  </Button>
                  {busy ? (
                    <Button type="button" size="sm" variant="outline" onClick={cancelUploads}>
                      <X /> Cancel
                    </Button>
                  ) : null}
                  {!busy && failures.length > 0 ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => void retryKeys(failures.map((item) => item.key))}>
                      <RotateCcw /> Retry failed ({failures.length})
                    </Button>
                  ) : null}
                  {!busy ? (
                    <Button type="button" size="sm" variant="outline" onClick={clearUploads}>
                      Dismiss
                    </Button>
                  ) : null}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">The exact file expiry and capability URL appear after upload.</p>
              </div>
            )}
          </Card>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3 text-xs"><span className="font-medium">File expiry</span><div className="flex flex-wrap gap-1" role="group" aria-label="File expiry">{([ ["1", "1 day"], ["3", "3 days"], ["7", "7 days"], ["30", "30 days"], ["permanent", "Permanent"] ] as const).map(([value, label]) => <button key={value} type="button" disabled={busy} aria-pressed={fileExpiry === value} className={`rounded-md border px-2 py-1 ${fileExpiry === value ? "border-primary bg-primary/10" : "text-muted-foreground hover:bg-accent"}`} onClick={() => setFileExpiry(value)}>{label}</button>)}</div><label className="flex items-center gap-2">HTML project <Input className="h-8 w-40" value={htmlProject} maxLength={120} onChange={(event) => setHtmlProject(event.target.value)} disabled={busy} placeholder="Optional" /></label></div>
          </div>
          <RecentArtifacts refreshKey={results.length} />
        </section>

        <UploadResultsList results={results} onCopyAll={() => void copyResultUrls(results)} onCopy={(result) => void copyResultUrls([result])} />
        {failures.length > 0 ? (
          <UploadIssuesList
            issues={failures}
            onRetryAll={() => void retryKeys(failures.map((item) => item.key))}
            onRetry={(key) => void retryKeys([key])}
          />
        ) : null}
      </main>
    </>
  );
}

function RecentArtifacts({ refreshKey }: { refreshKey: number }) {
  const [recent, setRecent] = useState<UploadSummary[]>([]);
  const [copied, setCopied] = useState<string>();
  const [copyError, setCopyError] = useState(false);
  useEffect(() => {
    let current = true;
    void fetchPublisherRead("/api/external-uploads?limit=6&sort=newest", { credentials: "same-origin" })
      .then(async (response) => response.ok ? response.json() as Promise<{ uploads: UploadSummary[] }> : { uploads: [] })
      .then((payload) => { if (current) setRecent(payload.uploads); }, () => undefined);
    return () => { current = false; };
  }, [refreshKey]);
  return <aside className="self-start overflow-hidden rounded-xl border bg-card" aria-labelledby="recent-artifacts-title"><div className="flex items-center justify-between border-b px-4 py-3"><h2 id="recent-artifacts-title" className="text-sm font-semibold">Recent</h2><Link className="text-xs text-muted-foreground hover:text-foreground" to="/publisher/artifacts" preload="intent">Library ›</Link></div>{recent.length ? <ul className="divide-y">{recent.map((upload) => <li key={upload.id} className="flex min-w-0 items-center gap-2 px-4 py-2.5"><span className="min-w-0 flex-1"><strong className="block truncate text-xs font-medium">{upload.filename}</strong><span className="block truncate text-xs text-muted-foreground">{upload.project ?? "Unassigned"} · {formatDateTime(upload.updatedAt)}</span></span><Badge variant={upload.expiresAt ? "outline" : "secondary"}>{upload.expiresAt ? "Temporary" : "Persistent"}</Badge><Button size="icon-sm" variant="ghost" aria-label={`Copy link for ${upload.filename}`} onClick={() => void navigator.clipboard.writeText(upload.url).then(() => { setCopied(upload.id); setCopyError(false); }, () => setCopyError(true))}>{copied === upload.id ? <Check /> : <Copy />}</Button></li>)}</ul> : <p className="px-4 py-5 text-xs text-muted-foreground">Published artifacts will appear here.</p>}{copyError ? <p className="border-t px-4 py-2 text-xs text-destructive" role="alert">Could not copy the link. Open Library to select it manually.</p> : null}</aside>;
}

export function UploadIssuesList({ issues, onRetryAll, onRetry }: { issues: UploadItem[]; onRetryAll: () => void; onRetry: (key: string) => void }) {
  if (issues.length === 0) return null;
  return (
    <section className="mt-4" aria-labelledby="upload-issues-title">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="upload-issues-title" className="font-semibold">Uploads needing attention ({issues.length})</h2>
        {issues.length > 1 ? <Button type="button" variant="outline" size="sm" onClick={onRetryAll}><RotateCcw /> Retry all failed</Button> : null}
      </div>
      <div className="grid gap-3">
        {issues.map((issue) => (
          <Card key={issue.key} className="gap-0 border-destructive/40 py-0">
            <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <Badge variant="destructive">Failed</Badge>
                <h3 className="mt-3 truncate font-semibold">{issue.name}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{formatBytes(issue.size)} · {issue.percent}% · {formatBytes(issue.loaded)} sent</p>
                {issue.error ? <p role="alert" className="mt-2 text-xs text-destructive">{issue.error}</p> : null}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => onRetry(issue.key)}><RotateCcw /> Retry</Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

export function UploadResultsList({ results, onCopyAll, onCopy }: { results: UploadSummary[]; onCopyAll: () => void; onCopy: (result: UploadSummary) => void }) {
  if (results.length === 0) return null;
  return (
    <section className="mt-4" aria-labelledby="uploaded-files-title">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="uploaded-files-title" className="font-semibold">Uploaded files ({results.length})</h2>
        {results.length > 1 ? <Button type="button" variant="outline" size="sm" onClick={onCopyAll}><Copy /> Copy all URLs</Button> : null}
      </div>
      <div className="grid gap-3">
        {results.map((result) => <Card key={result.id} className="gap-0 py-0"><div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><Badge variant="positive">Ready</Badge><h3 className="mt-3 truncate font-semibold">{result.filename}</h3><p className="mt-1 truncate font-mono text-xs text-muted-foreground">{result.url}</p><p className="mt-2 text-xs text-muted-foreground">{formatBytes(result.bytes)}{result.expiresAt ? ` · expires ${formatDateTime(result.expiresAt)}` : ""}</p></div><div className="flex shrink-0 gap-2"><Button type="button" variant="outline" size="sm" onClick={() => onCopy(result)}><Copy /> Copy URL</Button><Button nativeButton={false} variant="outline" size="sm" render={<a href={result.url} target="_blank" rel="noreferrer" />}><ExternalLink /> Open</Button></div></div></Card>)}
      </div>
    </section>
  );
}

export function capabilityUrlText(results: UploadSummary[]) {
  return results.map(({ url }) => url).join("\n");
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

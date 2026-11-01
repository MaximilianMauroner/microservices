import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Check, Copy, File, FileCode, RotateCw, Upload } from "lucide-react";
import { AppShell } from "../../src/components/app-shell.js";
import { PageHeader } from "../../src/components/page-header.js";
import { favicons } from "../../src/favicons.js";
import { Badge } from "../../src/components/ui/badge.js";
import { Button } from "../../src/components/ui/button.js";
import { Card } from "../../src/components/ui/card.js";
import { Input } from "../../src/components/ui/input.js";
import { countLabel } from "../../src/lib/count-label.js";
import { formatDateTime } from "../../src/lib/format-date.js";
import { cn } from "../../src/lib/utils.js";
import type { UploadPageData, UploadSummary } from "../../src/protected-data.js";
import { fetchPublisherRead, readPayload, waitForPublisher } from "./publisher-request.js";
import {
  UploadCancelledError,
  friendlyUploadError,
  parseErrorPayload,
  shouldUseChunkedUpload,
  uploadChunkedFile
} from "./chunked-upload.js";
import { Segmented } from "../../src/components/segmented.js";
import { ArtifactIcon, LifecycleBadge, copyText, formatBytes, relativeTime, shortUrl } from "./artifact-parts.js";

type ItemStatus = "queued" | "checking" | "uploading" | "processing" | "done" | "error" | "cancelled";

type UploadItem = {
  key: string;
  name: string;
  size: number;
  loaded: number;
  percent: number;
  status: ItemStatus;
  chunked: boolean;
  error?: string;
  result?: UploadSummary;
  expiryError?: string;
};

export type ExpiryChoice = "1" | "3" | "7" | "30" | "permanent";

const EXPIRY_OPTIONS = [
  ["1", "1 day"],
  ["3", "3 days"],
  ["7", "7 days"],
  ["30", "30 days"],
  ["permanent", "Permanent"]
] as const satisfies readonly (readonly [ExpiryChoice, string])[];

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_PATH = "/api/external-uploads?limit=6&sort=newest&includeSummary=true";

/** The expiry update for a new file. The server already applies 3 days, so that choice sends nothing. */
export function fileExpiryUpdate(choice: ExpiryChoice, now = Date.now()): { expiresAt: string | null } | undefined {
  if (choice === "3") return undefined;
  if (choice === "permanent") return { expiresAt: null };
  return { expiresAt: new Date(now + Number(choice) * DAY_MS).toISOString() };
}

/** Applies the chosen expiry to a finished file upload. HTML plans do not expire, so they are returned unchanged. */
export async function applyFileExpiry(
  upload: UploadSummary,
  choice: ExpiryChoice,
  fetcher: typeof fetch = globalThis.fetch,
  now = Date.now()
): Promise<UploadSummary> {
  const update = upload.kind === "file" ? fileExpiryUpdate(choice, now) : undefined;
  if (!update) return upload;
  const response = await fetcher(`/api/external-uploads/${upload.id}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update)
  });
  const { expiresAt } = await readPayload<{ expiresAt: string | null }>(response, "The file expiry could not be changed.");
  const { expiresAt: _serverDefault, ...permanent } = upload;
  return expiresAt ? { ...permanent, expiresAt } : permanent;
}

function isHtmlFile(name: string) {
  return /\.html?$/i.test(name);
}

function isAbortError(error: unknown, signal?: AbortSignal | null) {
  if (signal?.aborted) return true;
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function uploadExternalFile(
  file: File,
  project: string | undefined,
  onProgress: (loaded: number, total: number, lengthComputable: boolean) => void,
  onProcessing: () => void,
  registerXhr: (xhr: XMLHttpRequest | null) => void
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
    xhr.open("POST", "/api/external-uploads");
    xhr.setRequestHeader("Accept", "application/json");
    xhr.withCredentials = true;
    const form = new FormData();
    if (project) form.append("project", project);
    form.append("file", file);
    xhr.send(form);
  });
}

export function PublishPage() {
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [expiry, setExpiry] = useState<ExpiryChoice>("3");
  const [project, setProject] = useState("");
  const [copiedKey, setCopiedKey] = useState<string>();
  const [copyError, setCopyError] = useState<string>();
  const [recent, setRecent] = useState<UploadPageData>();
  const [recentError, setRecentError] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const activeXhr = useRef<XMLHttpRequest | null>(null);
  const abortController = useRef<AbortController | null>(null);
  const cancelRequested = useRef(false);
  const autoCopied = useRef(false);
  const fileByKey = useRef(new Map<string, File>());

  useEffect(() => {
    void loadRecent();
    return () => {
      cancelRequested.current = true;
      abortController.current?.abort();
      activeXhr.current?.abort();
    };
  }, []);

  async function loadRecent() {
    try {
      const response = await fetchPublisherRead(RECENT_PATH, { credentials: "same-origin" });
      setRecent(await readPayload<UploadPageData>(response, "Recent artifacts could not be loaded."));
      setRecentError(false);
    } catch {
      setRecentError(true);
    }
  }

  function updateItem(key: string, patch: Partial<UploadItem>) {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  function copyFirstLink(key: string, url: string) {
    if (autoCopied.current) return;
    autoCopied.current = true;
    void copyText(url).then((copied) => {
      if (copied) setCopiedKey(key);
    });
  }

  async function uploadOne(key: string, file: File, choice: { expiry: ExpiryChoice; project: string }) {
    const signal = abortController.current?.signal;
    updateItem(key, { status: "checking", percent: 0, loaded: 0, error: undefined });
    try {
      await waitForPublisher(undefined, globalThis.fetch, signal);
    } catch (error) {
      if (error instanceof UploadCancelledError || isAbortError(error, signal) || cancelRequested.current) {
        updateItem(key, { status: "cancelled" });
        return "cancelled" as const;
      }
      updateItem(key, { status: "error", error: error instanceof Error ? error.message : "The server check failed." });
      return "error" as const;
    }

    if (cancelRequested.current) {
      updateItem(key, { status: "cancelled" });
      return "cancelled" as const;
    }

    updateItem(key, { status: "uploading", percent: 0, loaded: 0 });
    try {
      const onProcessing = () => {
        updateItem(key, { status: "processing", loaded: file.size, percent: 100 });
      };
      const registerXhr = (xhr: XMLHttpRequest | null) => {
        activeXhr.current = xhr;
      };
      const payload = shouldUseChunkedUpload(file.size)
        ? await uploadChunkedFile(
            file,
            {
              onProgress: (loaded, total) => {
                const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
                updateItem(key, { status: "uploading", loaded, percent });
              },
              onProcessing,
              registerXhr,
              isCancelled: () => cancelRequested.current
            }
          )
        : await uploadExternalFile(
            file,
            isHtmlFile(file.name) && choice.project ? choice.project : undefined,
            (loaded, total, lengthComputable) => {
              const totalBytes = lengthComputable && total > 0 ? total : file.size;
              const percent = totalBytes > 0 ? Math.min(100, Math.round((loaded / totalBytes) * 100)) : 0;
              updateItem(key, { status: "uploading", loaded: Math.min(loaded, Math.max(totalBytes, file.size)), percent });
            },
            onProcessing,
            registerXhr
          );
      let result = payload;
      let expiryError: string | undefined;
      try {
        result = await applyFileExpiry(payload, choice.expiry);
      } catch (error) {
        expiryError = error instanceof Error ? error.message : "The file expiry could not be changed.";
      }
      updateItem(key, { status: "done", loaded: file.size, percent: 100, result, expiryError });
      copyFirstLink(key, result.url);
      return "done" as const;
    } catch (error) {
      if (error instanceof UploadCancelledError || isAbortError(error, signal) || cancelRequested.current) {
        updateItem(key, { status: "cancelled" });
        return "cancelled" as const;
      }
      updateItem(key, { status: "error", error: error instanceof Error ? error.message : "The upload failed." });
      return "error" as const;
    }
  }

  /** Uploads one file after the other. After a cancel, the files that did not start are marked as cancelled. */
  async function runQueue(keys: string[]) {
    cancelRequested.current = false;
    abortController.current?.abort();
    abortController.current = new AbortController();
    setBusy(true);
    setCopyError(undefined);
    const choice = { expiry, project: project.trim() };
    let succeeded = 0;
    try {
      for (const key of keys) {
        const file = fileByKey.current.get(key);
        if (cancelRequested.current) {
          updateItem(key, { status: "cancelled" });
          continue;
        }
        if (!file) {
          updateItem(key, { status: "error", error: "The file is no longer available. Choose it again." });
          continue;
        }
        if ((await uploadOne(key, file, choice)) === "done") succeeded += 1;
      }
    } finally {
      setBusy(false);
      activeXhr.current = null;
      if (fileInput.current) fileInput.current.value = "";
    }
    if (succeeded > 0) void loadRecent();
  }

  function startUpload(files: File[]) {
    if (files.length === 0 || busy) return;
    fileByKey.current.clear();
    autoCopied.current = false;
    setCopiedKey(undefined);
    const now = Date.now();
    const nextItems: UploadItem[] = files.map((file, index) => {
      const key = `${now}-${index}-${file.size}-${file.name}`;
      fileByKey.current.set(key, file);
      return { key, name: file.name, size: file.size, loaded: 0, percent: 0, status: "queued", chunked: shouldUseChunkedUpload(file.size) };
    });
    setItems(nextItems);
    void runQueue(nextItems.map((item) => item.key));
  }

  function retryKeys(keys: string[]) {
    if (keys.length === 0 || busy) return;
    const available = keys.filter((key) => fileByKey.current.has(key));
    for (const key of available) updateItem(key, { status: "queued", loaded: 0, percent: 0, error: undefined });
    void runQueue(available);
  }

  function cancelUploads() {
    cancelRequested.current = true;
    abortController.current?.abort();
    activeXhr.current?.abort();
  }

  function clearUploads() {
    if (busy) return;
    setItems([]);
    setCopiedKey(undefined);
    setCopyError(undefined);
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    startUpload(Array.from(event.currentTarget.files ?? []));
  }

  function dropFile(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    startUpload(Array.from(event.dataTransfer.files));
  }

  async function copyLinks(key: string | undefined, results: UploadSummary[]) {
    if (results.length === 0) return;
    if (await copyText(capabilityUrlText(results))) {
      setCopyError(undefined);
      if (key) setCopiedKey(key);
    } else {
      setCopyError("The links could not be copied. Open a file and copy its address.");
    }
  }

  const finished = items.flatMap((item) => (item.result ? [item.result] : []));
  const failures = items.filter((item) => item.status === "error");
  const projects = (recent?.summary?.projects ?? [])
    .flatMap(({ project: name, count }) => (name ? [{ name, count }] : []))
    .toSorted((left, right) => right.count - left.count || left.name.localeCompare(right.name));

  return (
    <>
      <AppShell product="Publisher" accent="violet" icon={favicons.publisher} />
      <main id="main" className="tools-page">
        <PageHeader title="Publish" facts="Drop a file to get a link. HTML plans stay until you revoke them; other files expire." />

        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(17.5rem,1fr)]">
          <div className="grid min-w-0 gap-3">
            <Card className="gap-0 py-0" aria-label="Upload">
              <div className="p-3.5">
                <div
                  className={cn(
                    "grid place-items-center gap-1.5 rounded-[0.875rem] border-[1.5px] border-dashed border-control-border bg-[color-mix(in_oklab,var(--secondary)_35%,var(--card))] px-5 py-8.5 text-center transition-colors",
                    dragging && "border-primary bg-secondary"
                  )}
                  onDragEnter={(event) => { event.preventDefault(); if (!busy) setDragging(true); }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={() => setDragging(false)}
                  onDrop={dropFile}
                >
                  <span className="grid size-11 place-items-center rounded-xl bg-secondary text-secondary-foreground [&_svg]:size-5.5" aria-hidden="true"><Upload /></span>
                  <strong className="text-[0.9375rem] font-semibold">Drop files here</strong>
                  <span className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
                    or
                    <Button type="button" size="sm" onClick={() => fileInput.current?.click()} disabled={busy}>Choose files</Button>
                  </span>
                  <span className="text-xs text-muted-foreground">Up to 5 GB · HTML up to 25 MB · the link is unlisted</span>
                  <input className="hidden" ref={fileInput} type="file" multiple onChange={chooseFile} aria-label="Choose files to upload" tabIndex={-1} />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/60 px-4 py-3 text-[0.8125rem] text-muted-foreground">
                <span className="flex max-w-full min-w-0 flex-wrap items-center gap-2">
                  File expiry
                  <Segmented label="File expiry" options={EXPIRY_OPTIONS} value={expiry} onValue={setExpiry} />
                </span>
                <label className="flex max-w-full min-w-0 items-center gap-2">
                  HTML project
                  <Input
                    className="h-7 w-38 text-[0.8125rem] text-foreground md:text-[0.8125rem]"
                    list="publish-projects"
                    value={project}
                    onChange={(event) => setProject(event.currentTarget.value)}
                    placeholder="None"
                    aria-label="Project for HTML plans"
                    disabled={busy}
                  />
                  <datalist id="publish-projects">{projects.map(({ name }) => <option key={name} value={name} />)}</datalist>
                </label>
              </div>
            </Card>

            {items.length > 0 ? (
              <Card className="gap-0 py-0" aria-labelledby="session-title">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pt-3">
                  <div className="min-w-0">
                    <h2 id="session-title" className="text-sm font-semibold">This session</h2>
                    <p className="mt-px text-xs text-muted-foreground" aria-live="polite">{sessionSummary(items, busy)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {finished.length > 0 ? <Button type="button" variant="outline" size="sm" onClick={() => void copyLinks(undefined, finished)}><Copy /> Copy {countLabel(finished.length, "link")}</Button> : null}
                    {!busy && failures.length > 1 ? <Button type="button" variant="outline" size="sm" onClick={() => retryKeys(failures.map((item) => item.key))}><RotateCw /> Retry all</Button> : null}
                    {!busy ? <Button type="button" variant="ghost" size="sm" onClick={clearUploads}>Clear</Button> : null}
                  </div>
                </div>
                {copyError ? <p role="alert" className="px-4 pt-2 text-xs text-destructive">{copyError}</p> : null}
                <ul className="mt-2 divide-y divide-border/60" aria-label="Uploads">
                  {items.map((item) => (
                    <SessionRow
                      key={item.key}
                      item={item}
                      busy={busy}
                      copied={copiedKey === item.key}
                      onCopy={(result) => void copyLinks(item.key, [result])}
                      onCancel={cancelUploads}
                      onRetry={() => retryKeys([item.key])}
                    />
                  ))}
                </ul>
              </Card>
            ) : null}
          </div>

          <RecentArtifacts uploads={recent?.uploads} failed={recentError} />
        </div>
      </main>
    </>
  );
}

function sessionSummary(items: UploadItem[], busy: boolean) {
  const count = (status: ItemStatus) => items.filter((item) => item.status === status).length;
  const done = count("done");
  const failed = count("error");
  const cancelled = count("cancelled");
  if (busy) return `Uploading ${Math.min(done + failed + cancelled + 1, items.length)} of ${items.length}`;
  if (failed === 0 && cancelled === 0) return done === 1 ? "The file is ready." : `${done} files are ready.`;
  const parts = [done > 0 ? `${done} uploaded` : "", failed > 0 ? `${failed} failed` : "", cancelled > 0 ? `${cancelled} cancelled` : ""];
  return `${parts.filter(Boolean).join(", ")}.`;
}

function SessionRow({ item, busy, copied, onCopy, onCancel, onRetry }: {
  item: UploadItem;
  busy: boolean;
  copied: boolean;
  onCopy: (result: UploadSummary) => void;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const active = item.status === "checking" || item.status === "uploading" || item.status === "processing";
  const result = item.result;
  return (
    <li className="flex min-w-0 items-center gap-3 px-4 py-2.5">
      <ArtifactIcon kind={result?.kind ?? (isHtmlFile(item.name) ? "html" : "file")} icon={isHtmlFile(item.name) ? <FileCode /> : <File />} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" title={item.name}>{item.name}</p>
        <SessionRowDetail item={item} />
        {item.status === "uploading" || item.status === "processing" ? (
          <div className="mt-1.5 h-1 overflow-hidden rounded-sm bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.percent} aria-label={`Upload progress for ${item.name}`}>
            <div className="h-full rounded-sm bg-primary" style={{ width: `${item.percent}%` }} />
          </div>
        ) : null}
      </div>
      {active ? (
        <>
          {item.status === "uploading" ? <span className="text-[0.8125rem] text-muted-foreground tabular-nums">{item.percent}%</span> : null}
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        </>
      ) : null}
      {item.status === "error" ? <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={busy}><RotateCw /> Retry</Button> : null}
      {result ? (
        <>
          <Badge className="max-sm:hidden" variant="positive">{copied ? <><Check /> Copied</> : "Ready"}</Badge>
          <Button type="button" variant="outline" size="icon-sm" aria-label={`Copy link for ${result.filename}`} onClick={() => onCopy(result)}><Copy /></Button>
          <Button className="max-sm:hidden" nativeButton={false} variant="outline" size="icon-sm" aria-label={`Open ${result.filename}`} render={<a href={result.url} target="_blank" rel="noreferrer" />}><ArrowUpRight /></Button>
        </>
      ) : null}
    </li>
  );
}

function SessionRowDetail({ item }: { item: UploadItem }) {
  const detail = "truncate text-xs text-muted-foreground";
  if (item.result) {
    const { result } = item;
    return (
      <>
        <p className={cn(detail, "font-mono")}>
          {shortUrl(result.url)} · {result.kind === "html" ? "stays until revoked" : result.expiresAt ? `expires ${formatDateTime(result.expiresAt)}` : "permanent"}
        </p>
        {item.expiryError ? <p role="alert" className="text-xs text-warning">The expiry was not changed: {item.expiryError}</p> : null}
      </>
    );
  }
  if (item.status === "error") return <p role="alert" className="text-xs text-destructive">{item.error}</p>;
  if (item.status === "queued") return <p className={detail}>{formatBytes(item.size)} · waiting</p>;
  if (item.status === "checking") return <p className={detail}>Checking the server</p>;
  if (item.status === "processing") return <p className={detail}>Finishing on the server</p>;
  if (item.status === "cancelled") return <p className={detail}>Cancelled</p>;
  return (
    <p className={detail}>
      {formatBytes(item.loaded)} of {formatBytes(item.size)}{item.chunked ? " · sent in 20 MB parts" : ""}
    </p>
  );
}

function RecentArtifacts({ uploads, failed }: { uploads?: UploadSummary[]; failed: boolean }) {
  const [copiedId, setCopiedId] = useState<string>();
  const now = Date.now();
  return (
    <Card className="gap-0 py-0" aria-labelledby="recent-title">
      <div className="flex items-center justify-between gap-3 px-4 pt-3">
        <h2 id="recent-title" className="text-sm font-semibold">Recent</h2>
        <Link className="text-[0.8125rem] text-muted-foreground hover:text-foreground" to="/publisher/artifacts" preload="intent">Library ›</Link>
      </div>
      {uploads && uploads.length > 0 ? (
        <ul className="mt-2 divide-y divide-border/60">
          {uploads.map((upload) => (
            <li key={upload.id} className="flex min-w-0 items-center gap-3 px-4 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium" title={upload.filename}>{upload.filename}</p>
                <p className="truncate text-xs text-muted-foreground">{upload.project ?? "Unassigned"} · {relativeTime(upload.updatedAt, now)}</p>
              </div>
              <LifecycleBadge upload={upload} now={now} />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Copy link for ${upload.filename}`}
                onClick={() => void copyText(upload.url).then((copied) => setCopiedId(copied ? upload.id : undefined))}
              >
                {copiedId === upload.id ? <Check /> : <Copy />}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 pt-2 pb-3.5 text-[0.8125rem] text-muted-foreground">
          {failed ? "Recent artifacts could not be loaded." : uploads ? "Nothing is published yet." : "Loading recent artifacts…"}
        </p>
      )}
      {uploads && uploads.length > 0 ? <div className="h-1.5" /> : null}
    </Card>
  );
}

export function capabilityUrlText(results: UploadSummary[]) {
  return results.map(({ url }) => url).join("\n");
}

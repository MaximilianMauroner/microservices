import { useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Copy, ExternalLink, FolderOpen, Upload } from "lucide-react";
import { AppShell } from "../../src/components/app-shell.js";
import { favicons } from "../../src/favicons.js";
import { Alert } from "../../src/components/ui/alert.js";
import { Badge } from "../../src/components/ui/badge.js";
import { Button } from "../../src/components/ui/button.js";
import { Card } from "../../src/components/ui/card.js";
import { Input } from "../../src/components/ui/input.js";
import type { UploadSummary } from "../../src/protected-data.js";
import { waitForPublisher } from "./publisher-request.js";

export function PublishPage() {
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [results, setResults] = useState<UploadSummary[]>([]);
  const [progress, setProgress] = useState<{ completed: number; total: number }>();
  const [message, setMessage] = useState<{ text: string; tone: "success" | "error" }>();
  const fileInput = useRef<HTMLInputElement>(null);

  async function uploadFiles(files: File[]) {
    if (files.length === 0 || busy) return;
    setBusy(true);
    setResults([]);
    setProgress({ completed: 0, total: files.length });
    setMessage(undefined);
    const uploaded: UploadSummary[] = [];
    const failures: string[] = [];
    try {
      for (const [index, file] of files.entries()) {
        setProgress({ completed: index, total: files.length });
        try {
          await waitForPublisher();
          const form = new FormData();
          form.append("file", file);
          const response = await fetch("/api/external-uploads", {
            method: "POST",
            credentials: "same-origin",
            body: form
          });
          const payload = await response.json().catch(() => ({})) as UploadSummary & { message?: string };
          if (!response.ok) throw new Error(payload.message ?? `Upload failed (HTTP ${response.status}).`);
          uploaded.push(payload);
          setResults([...uploaded]);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "The upload failed.";
          failures.push(`${file.name}: ${reason}`);
        }
      }

      if (failures.length === 0) {
        setMessage({
          text: uploaded.length === 1 ? `${uploaded[0]!.filename} is ready to share.` : `${uploaded.length} files are ready to share.`,
          tone: "success"
        });
      } else {
        const summary = uploaded.length > 0 ? `${uploaded.length} uploaded, ${failures.length} failed.` : `${failures.length} upload${failures.length === 1 ? "" : "s"} failed.`;
        setMessage({ text: `${summary} ${failures.join(" ")}`, tone: "error" });
      }
    } finally {
      setBusy(false);
      setProgress(undefined);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    void uploadFiles(Array.from(event.currentTarget.files ?? []));
  }

  function dropFile(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void uploadFiles(Array.from(event.dataTransfer.files));
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

  return (
    <>
      <AppShell product="Publisher" accent="violet" icon={favicons.publisher} showSignOut />
      <main id="main" className="workspace-page workspace-page--narrow">
        <section className="workspace-header" aria-labelledby="publish-title">
          <div>
            <p className="workspace-header__eyebrow">Artifact publisher</p>
            <h1 id="publish-title">Share a new file.</h1>
            <p className="workspace-header__description">Upload once, then maintain it from the artifact library.</p>
          </div>
          <div className="workspace-header__actions"><Button nativeButton={false} variant="outline" size="sm" render={<Link to="/publisher/artifacts" preload="intent" />}>
            <FolderOpen /> Manage artifacts
          </Button></div>
        </section>

        {message ? <Alert className="mb-4" variant={message.tone === "error" ? "destructive" : "default"}>{message.text}</Alert> : null}

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,.6fr)]" aria-label="Upload workspace">
          <Card className={`grid min-h-72 place-items-center border border-dashed text-center transition-colors ${dragging ? "border-foreground bg-secondary" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={dropFile}>
            <div className="max-w-md p-6">
              <div className="mx-auto mb-4 grid size-11 place-items-center rounded-full border text-muted-foreground" aria-hidden="true"><Upload /></div>
              <strong className="text-lg">{busy && progress ? `Uploading ${progress.completed + 1} of ${progress.total}…` : "Drop files here"}</strong>
              <p className="mt-2 text-sm text-muted-foreground">Browser uploads are temporary, unlisted downloads that expire automatically.</p>
              <Input className="hidden" ref={fileInput} type="file" multiple onChange={chooseFile} aria-label="Choose files to upload" tabIndex={-1} />
              <Button className="mt-5" type="button" size="sm" onClick={() => fileInput.current?.click()} disabled={busy}>
                {busy ? "Working…" : "Choose files"}
              </Button>
            </div>
          </Card>
          <aside className="rounded-xl border bg-card p-5" aria-label="Upload policy">
            <h2 className="font-semibold">Upload policy</h2>
            <p className="mt-2 text-sm text-muted-foreground">Generated URLs are public, unlisted capability links. Anyone with the URL can download the file until it expires or is revoked.</p>
            <dl className="mt-5 grid gap-3 text-xs"><div><dt className="text-muted-foreground">Delivery</dt><dd className="mt-1 font-medium">Temporary download</dd></div><div><dt className="text-muted-foreground">Access</dt><dd className="mt-1 font-medium">Unlisted URL</dd></div><div><dt className="text-muted-foreground">Maintenance</dt><dd className="mt-1 font-medium">Manage artifact library</dd></div></dl>
          </aside>
        </section>

        <UploadResultsList results={results} onCopyAll={() => void copyResultUrls(results)} onCopy={(result) => void copyResultUrls([result])} />
      </main>
    </>
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
        {results.map((result) => <Card key={result.id} className="gap-0 py-0"><div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><Badge variant="default">Ready</Badge><h3 className="mt-3 truncate font-semibold">{result.filename}</h3><p className="mt-1 truncate font-mono text-xs text-muted-foreground">{result.url}</p><p className="mt-2 text-xs text-muted-foreground">{formatBytes(result.bytes)}{result.expiresAt ? ` · expires ${formatDate(result.expiresAt)}` : ""}</p></div><div className="flex shrink-0 gap-2"><Button type="button" variant="outline" size="sm" onClick={() => onCopy(result)}><Copy /> Copy URL</Button><Button nativeButton={false} size="sm" render={<a href={result.url} target="_blank" rel="noreferrer" />}><ExternalLink /> Open</Button></div></div></Card>)}
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) + " UTC";
}

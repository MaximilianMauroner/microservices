import { useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Copy, ExternalLink, FolderOpen, Upload } from "lucide-react";
import { AppShell } from "../../src/components/app-shell.js";
import { Alert } from "../../src/components/ui/alert.js";
import { Badge } from "../../src/components/ui/badge.js";
import { Button } from "../../src/components/ui/button.js";
import { Card } from "../../src/components/ui/card.js";
import { Input } from "../../src/components/ui/input.js";
import type { UploadSummary } from "../../src/protected-data.js";

export function PublishPage() {
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<UploadSummary>();
  const [message, setMessage] = useState<{ text: string; tone: "success" | "error" }>();
  const fileInput = useRef<HTMLInputElement>(null);

  async function uploadFile(file: File) {
    setBusy(true);
    setResult(undefined);
    setMessage(undefined);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/external-uploads", {
        method: "POST",
        credentials: "same-origin",
        body: form
      });
      const payload = await response.json().catch(() => ({})) as UploadSummary & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? `Upload failed (HTTP ${response.status}).`);
      setResult(payload);
      setMessage({ text: `${payload.filename} is ready to share.`, tone: "success" });
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

  async function copyResultUrl() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      setMessage({ text: "Capability URL copied.", tone: "success" });
    } catch {
      setMessage({ text: "The URL could not be copied. Open the upload to copy it manually.", tone: "error" });
    }
  }

  return (
    <>
      <AppShell product="Publisher" accent="violet" showSignOut />
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
              <strong className="text-lg">{busy ? "Uploading…" : "Drop a file here"}</strong>
              <p className="mt-2 text-sm text-muted-foreground">Browser uploads are temporary, unlisted downloads that expire automatically.</p>
              <Input className="sr-only" ref={fileInput} type="file" onChange={chooseFile} aria-label="Choose a file to upload" />
              <Button className="mt-5" type="button" size="sm" onClick={() => fileInput.current?.click()} disabled={busy}>
                {busy ? "Working…" : "Choose file"}
              </Button>
            </div>
          </Card>
          <aside className="rounded-xl border bg-card p-5" aria-label="Upload policy">
            <h2 className="font-semibold">Upload policy</h2>
            <p className="mt-2 text-sm text-muted-foreground">Generated URLs are public, unlisted capability links. Anyone with the URL can download the file until it expires or is revoked.</p>
            <dl className="mt-5 grid gap-3 text-xs"><div><dt className="text-muted-foreground">Delivery</dt><dd className="mt-1 font-medium">Temporary download</dd></div><div><dt className="text-muted-foreground">Access</dt><dd className="mt-1 font-medium">Unlisted URL</dd></div><div><dt className="text-muted-foreground">Maintenance</dt><dd className="mt-1 font-medium">Manage artifact library</dd></div></dl>
          </aside>
        </section>

        {result ? <Card className="mt-4 gap-0 py-0"><div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><Badge variant="default">Ready</Badge><h2 className="mt-3 truncate font-semibold">{result.filename}</h2><p className="mt-1 truncate font-mono text-xs text-muted-foreground">{result.url}</p><p className="mt-2 text-xs text-muted-foreground">{formatBytes(result.bytes)}{result.expiresAt ? ` · expires ${formatDate(result.expiresAt)}` : ""}</p></div><div className="flex shrink-0 gap-2"><Button type="button" variant="outline" size="sm" onClick={() => void copyResultUrl()}><Copy /> Copy URL</Button><Button nativeButton={false} size="sm" render={<a href={result.url} target="_blank" rel="noreferrer" />}><ExternalLink /> Open</Button></div></div></Card> : null}
      </main>
    </>
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

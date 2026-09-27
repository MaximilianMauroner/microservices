import { useEffect, useRef, useState } from "react";
import { Copy, Download, Link2, Plus, RotateCcw, X } from "lucide-react";
import { Alert } from "../../src/components/ui/alert.js";
import { Badge } from "../../src/components/ui/badge.js";
import { Button } from "../../src/components/ui/button.js";
import { NativeSelect } from "../../src/components/ui/native-select.js";
import { Card } from "../../src/components/ui/card.js";
import { formatDateTime } from "../../src/lib/format-date.js";
import { AppShell } from "../../src/components/app-shell.js";
import { PageHeader } from "../../src/components/page-header.js";
import { favicons } from "../../src/favicons.js";

type UploadLinkSummary = {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  fileCount: number;
};

type CreatedUploadLink = UploadLinkSummary & { url: string };

const durations = [
  { label: "1 hour", value: 60 * 60 * 1000 },
  { label: "1 day", value: 24 * 60 * 60 * 1000 },
  { label: "3 days", value: 3 * 24 * 60 * 60 * 1000 },
  { label: "7 days", value: 7 * 24 * 60 * 60 * 1000 },
  { label: "30 days", value: 30 * 24 * 60 * 60 * 1000 }
] as const;

export function ReceiveFilesPage() {
  return <><AppShell product="Publisher" accent="violet" icon={favicons.publisher} /><main id="main" className="tools-page"><PageHeader title="Receive files" facts="People with an active link can send you files without signing in." /><UploadLinkManager /></main></>;
}

export function UploadLinkManager() {
  const [links, setLinks] = useState<UploadLinkSummary[]>([]);
  const [durationMs, setDurationMs] = useState<number>(durations[1].value);
  const [created, setCreated] = useState<CreatedUploadLink>();
  const [nextCursor, setNextCursor] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const linksRevision = useRef(0);
  const createdRef = useRef<HTMLDivElement>(null);

  async function loadLinks() {
    const revision = ++linksRevision.current;
    setError(undefined);
    await fetch("/api/upload-links", { headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("Upload links could not be loaded.");
        return response.json() as Promise<{ links: UploadLinkSummary[]; nextCursor?: string }>;
      })
      .then((payload) => {
        if (revision !== linksRevision.current) return;
        setLinks(payload.links);
        setNextCursor(payload.nextCursor);
      })
      .catch((reason: unknown) => {
        if (revision === linksRevision.current) {
          setError(reason instanceof Error ? reason.message : "Upload links could not be loaded.");
        }
      });
  }

  async function loadOlderLinks() {
    if (!nextCursor || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/upload-links?cursor=${encodeURIComponent(nextCursor)}`, {
        headers: { Accept: "application/json" }
      });
      if (!response.ok) throw new Error("Older upload links could not be loaded.");
      const payload = await response.json() as { links: UploadLinkSummary[]; nextCursor?: string };
      setLinks((current) => [...current, ...payload.links]);
      setNextCursor(payload.nextCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Older upload links could not be loaded.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadLinks();
  }, []);

  async function createLink() {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/upload-links?durationMs=${durationMs}`, {
        method: "POST",
        headers: { Accept: "application/json" }
      });
      const payload = await response.json() as CreatedUploadLink & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Upload link could not be created.");
      linksRevision.current += 1;
      setCreated(payload);
      setLinks((current) => [payload, ...current]);
      requestAnimationFrame(() => createdRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Upload link could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeLink(id: string) {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/upload-links/${id}`, { method: "DELETE", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Upload link could not be revoked.");
      linksRevision.current += 1;
      const revokedAt = new Date().toISOString();
      setLinks((current) => current.map((link) => link.id === id ? { ...link, revokedAt } : link));
      if (created?.id === id) setCreated((current) => current ? { ...current, revokedAt } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Upload link could not be revoked.");
    } finally {
      setBusy(false);
    }
  }

  async function copyCreated() {
    if (!created) return;
    try { await navigator.clipboard.writeText(created.url); }
    catch { setError("The link could not be copied. Select and copy it manually."); }
  }

  const now = Date.now();
  return (
    <section aria-labelledby="upload-links-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="upload-links-title" className="text-sm font-semibold">Upload links</h2>
        <div className="flex items-center gap-2"><NativeSelect className="w-32" aria-label="Link duration" value={durationMs} onChange={(event) => setDurationMs(Number(event.currentTarget.value))} disabled={busy}>{durations.map((duration) => <option key={duration.value} value={duration.value}>{duration.label}</option>)}</NativeSelect><Button type="button" size="sm" onClick={() => void createLink()} disabled={busy}><Plus /> Create link</Button><Button type="button" variant="outline" size="icon-sm" aria-label="Refresh links" onClick={() => void loadLinks()} disabled={busy}><RotateCcw /></Button></div>
      </div>
      {error ? <Alert className="mb-3" variant="destructive">{error}</Alert> : null}
        {created ? <Card ref={createdRef} className="mb-3 gap-3 border border-primary/30 bg-secondary p-4" aria-live="polite">
          <div className="flex items-center gap-2"><Badge>New link</Badge><span className="text-xs text-muted-foreground">Copy it now; the secret is not stored.</span></div>
          <p className="mt-3 break-all font-mono text-xs">{created.url}</p>
          <div className="mt-3 flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" onClick={() => void copyCreated()}><Copy /> Copy link</Button><Button nativeButton={false} variant="outline" size="sm" render={<a href={created.url} target="_blank" rel="noreferrer" />}><Link2 /> Open link</Button></div>
        </Card> : null}
      {links.length > 0 ? <div className="overflow-x-auto rounded-xl border bg-card" aria-label="Upload links"><table className="w-full text-left text-sm"><thead className="border-b text-xs text-muted-foreground"><tr><th className="px-4 py-2">Link</th><th className="px-4 py-2">Status</th><th className="hidden px-4 py-2 text-right sm:table-cell">Files</th><th className="hidden px-4 py-2 sm:table-cell">Expires</th><th className="px-4 py-2 text-right"><span className="sr-only">Actions</span></th></tr></thead><tbody className="divide-y">
        {links.map((link) => {
          const active = !link.revokedAt && new Date(link.expiresAt).getTime() > now;
          return <tr key={link.id}><td className="px-4 py-2"><strong className="block text-xs font-medium">Created {formatDateTime(link.createdAt)}</strong><span className="block text-xs text-muted-foreground sm:hidden">{link.fileCount} files · expires {formatDateTime(link.expiresAt)}</span></td><td className="px-4 py-2"><Badge variant={active ? "positive" : "secondary"}>{link.revokedAt ? "Revoked" : active ? "Active" : "Expired"}</Badge></td><td className="hidden px-4 py-2 text-right tabular-nums sm:table-cell">{link.fileCount}</td><td className="hidden px-4 py-2 text-xs text-muted-foreground sm:table-cell">{formatDateTime(link.expiresAt)}</td><td className="px-4 py-2"><div className="flex justify-end gap-1">{active && created?.id === link.id ? <Button type="button" variant="ghost" size="icon-sm" aria-label="Copy upload link" onClick={() => void copyCreated()}><Copy /></Button> : null}{link.fileCount > 0 ? <Button nativeButton={false} variant="ghost" size="icon-sm" aria-label="Download received files" render={<a href={`/api/upload-links/${link.id}/download`} />}><Download /></Button> : null}{!link.revokedAt ? <Button type="button" variant="destructive-subtle" size="sm" onClick={() => void revokeLink(link.id)} disabled={busy}><X /> Revoke</Button> : null}</div></td></tr>;
        })}</tbody></table>{nextCursor ? <div className="flex justify-center border-t p-3"><Button type="button" variant="outline" size="sm" onClick={() => void loadOlderLinks()} disabled={busy}>Load older links</Button></div> : null}<p className="border-t px-4 py-3 text-xs text-muted-foreground">Older link URLs cannot be shown again because their secrets are not stored.</p></div> : <p className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">No upload links yet. Create one to receive files.</p>}
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import { Copy, Download, Link2, Plus, RotateCcw, X } from "lucide-react";
import { Alert } from "../../src/components/ui/alert.js";
import { Badge } from "../../src/components/ui/badge.js";
import { Button } from "../../src/components/ui/button.js";
import { Card } from "../../src/components/ui/card.js";

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

export function UploadLinkManager() {
  const [links, setLinks] = useState<UploadLinkSummary[]>([]);
  const [durationMs, setDurationMs] = useState<number>(durations[1].value);
  const [created, setCreated] = useState<CreatedUploadLink>();
  const [nextCursor, setNextCursor] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const linksRevision = useRef(0);

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
    <section className="mt-6" aria-labelledby="upload-links-title">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div><p className="workspace-header__eyebrow">Receive files</p>
          <h2 id="upload-links-title" className="text-xl font-semibold">Guest upload links</h2>
          <p className="mt-1 text-sm text-muted-foreground">Anyone with an active link can send any number of files without signing in.</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => void loadLinks()} disabled={busy}><RotateCcw /> Refresh</Button>
      </div>
      {error ? <Alert className="mb-3" variant="destructive">{error}</Alert> : null}
      <Card className="gap-4 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="grid flex-1 gap-1 text-sm font-medium">Link duration
            <select className="h-9 rounded-md border bg-transparent px-3 text-sm" value={durationMs} onChange={(event) => setDurationMs(Number(event.currentTarget.value))} disabled={busy}>
              {durations.map((duration) => <option key={duration.value} value={duration.value}>{duration.label}</option>)}
            </select>
          </label>
          <Button type="button" size="sm" onClick={() => void createLink()} disabled={busy}><Plus /> Create upload link</Button>
        </div>
        {created ? <div className="rounded-lg border border-primary/30 bg-secondary p-4" aria-live="polite">
          <div className="flex items-center gap-2"><Badge>New link</Badge><span className="text-xs text-muted-foreground">Copy it now; the secret is not stored.</span></div>
          <p className="mt-3 break-all font-mono text-xs">{created.url}</p>
          <Button className="mt-3" type="button" variant="outline" size="sm" onClick={() => void copyCreated()}><Copy /> Copy link</Button>
        </div> : null}
      </Card>
      {links.length > 0 ? <div className="mt-3 grid gap-2" aria-label="Upload links">
        {links.map((link) => {
          const active = !link.revokedAt && new Date(link.expiresAt).getTime() > now;
          return <Card key={link.id} className="gap-0 py-0"><div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0"><div className="flex items-center gap-2"><Link2 className="size-4" aria-hidden="true" /><Badge variant={active ? "default" : "secondary"}>{link.revokedAt ? "Revoked" : active ? "Active" : "Expired"}</Badge></div><p className="mt-2 text-xs text-muted-foreground">{link.fileCount} {link.fileCount === 1 ? "file" : "files"} received · created {formatDate(link.createdAt)} · expires {formatDate(link.expiresAt)}</p></div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {link.fileCount > 0 ? <Button nativeButton={false} variant="outline" size="sm" render={<a href={`/api/upload-links/${link.id}/download`} />}><Download /> Download all</Button> : null}
              {!link.revokedAt ? <Button type="button" variant="outline" size="sm" onClick={() => void revokeLink(link.id)} disabled={busy}><X /> Revoke</Button> : null}
            </div>
          </div></Card>;
        })}
        {nextCursor ? <div className="flex justify-center pt-1"><Button type="button" variant="ghost" size="sm" onClick={() => void loadOlderLinks()} disabled={busy}>Load older links</Button></div> : null}
      </div> : null}
    </section>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) + " UTC";
}

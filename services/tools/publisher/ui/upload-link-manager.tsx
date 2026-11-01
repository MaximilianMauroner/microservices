import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, Copy, Download, Link2 } from "lucide-react";
import { AppShell } from "../../src/components/app-shell.js";
import { PageHeader } from "../../src/components/page-header.js";
import { favicons } from "../../src/favicons.js";
import { Alert } from "../../src/components/ui/alert.js";
import { Badge } from "../../src/components/ui/badge.js";
import { Button } from "../../src/components/ui/button.js";
import { Card } from "../../src/components/ui/card.js";
import { NativeSelect, NativeSelectOption } from "../../src/components/ui/native-select.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../src/components/ui/table.js";
import { countLabel } from "../../src/lib/count-label.js";
import { formatDateTime } from "../../src/lib/format-date.js";
import { cn } from "../../src/lib/utils.js";
import { UrlBox, copyText } from "./artifact-parts.js";

export type UploadLinkSummary = {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  fileCount: number;
};

type CreatedUploadLink = UploadLinkSummary & { url: string; durationLabel: string };

const durations = [
  { label: "1 hour", value: 60 * 60 * 1000 },
  { label: "1 day", value: 24 * 60 * 60 * 1000 },
  { label: "3 days", value: 3 * 24 * 60 * 60 * 1000 },
  { label: "7 days", value: 7 * 24 * 60 * 60 * 1000 },
  { label: "30 days", value: 30 * 24 * 60 * 60 * 1000 }
] as const;

/** Guest upload links: people with an active link send files without an account. */
export function ReceiveFilesPage() {
  const [links, setLinks] = useState<UploadLinkSummary[]>();
  const [durationMs, setDurationMs] = useState<number>(durations[1].value);
  const [created, setCreated] = useState<CreatedUploadLink>();
  const [copied, setCopied] = useState(false);
  const [nextCursor, setNextCursor] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const linksRevision = useRef(0);

  async function loadLinks() {
    const revision = ++linksRevision.current;
    setError(undefined);
    await fetch("/api/upload-links", { headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("The links could not be loaded.");
        return response.json() as Promise<{ links: UploadLinkSummary[]; nextCursor?: string }>;
      })
      .then((payload) => {
        if (revision !== linksRevision.current) return;
        setLinks(payload.links);
        setNextCursor(payload.nextCursor);
      })
      .catch((reason: unknown) => {
        if (revision === linksRevision.current) {
          setLinks((current) => current ?? []);
          setError(reason instanceof Error ? reason.message : "The links could not be loaded.");
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
      if (!response.ok) throw new Error("Older links could not be loaded.");
      const payload = await response.json() as { links: UploadLinkSummary[]; nextCursor?: string };
      setLinks((current) => [...(current ?? []), ...payload.links]);
      setNextCursor(payload.nextCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Older links could not be loaded.");
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
      const payload = await response.json() as (UploadLinkSummary & { url: string }) & { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "The link could not be created.");
      linksRevision.current += 1;
      const durationLabel = durations.find((duration) => duration.value === durationMs)?.label ?? "the chosen time";
      setCreated({ ...payload, durationLabel });
      setCopied(false);
      setLinks((current) => [payload, ...(current ?? [])]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The link could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeLink(id: string) {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/upload-links/${id}`, { method: "DELETE", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("The link could not be revoked.");
      linksRevision.current += 1;
      const revokedAt = new Date().toISOString();
      setLinks((current) => current?.map((link) => link.id === id ? { ...link, revokedAt } : link));
      if (created?.id === id) setCreated(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The link could not be revoked.");
    } finally {
      setBusy(false);
    }
  }

  async function copyCreated() {
    if (!created) return;
    if (await copyText(created.url)) setCopied(true);
    else setError("The link could not be copied. Select it and copy it by hand.");
  }

  return (
    <>
      <AppShell product="Publisher" accent="violet" icon={favicons.publisher} />
      <main id="main" className="tools-page">
        <PageHeader
          title="Receive files"
          facts="People with an active link can send you files without signing in."
          actions={<>
            <NativeSelect className="w-28" size="sm" aria-label="Link duration" value={durationMs} onChange={(event) => setDurationMs(Number(event.currentTarget.value))} disabled={busy}>
              {durations.map((duration) => <NativeSelectOption key={duration.value} value={duration.value}>{duration.label}</NativeSelectOption>)}
            </NativeSelect>
            <Button type="button" size="sm" onClick={() => void createLink()} disabled={busy}><Link2 /> Create link</Button>
          </>}
        />

        {error ? <Alert className="mb-3" variant="destructive">{error}</Alert> : null}

        <div className="grid gap-3">
          {created ? (
            <Card className="gap-0 py-0 ring-[color:var(--product-accent-border)]" aria-labelledby="new-link-title" aria-live="polite">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 pt-3">
                <h2 id="new-link-title" className="text-sm font-semibold">New link · valid for {created.durationLabel}</h2>
                <p className="text-xs text-muted-foreground">Copy it now. The link secret is not stored, so it cannot be shown again.</p>
              </div>
              <div className="px-4 pt-2.5 pb-3.5">
                <UrlBox url={created.url}>
                  <Button type="button" size="sm" onClick={() => void copyCreated()}>{copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}</Button>
                  <Button nativeButton={false} variant="ghost" size="icon-sm" aria-label="Open the new link" render={<a href={created.url} target="_blank" rel="noreferrer" />}><ArrowUpRight /></Button>
                </UrlBox>
              </div>
            </Card>
          ) : null}

          <UploadLinkTable
            links={links}
            busy={busy}
            hasMore={Boolean(nextCursor)}
            onRevoke={(id) => void revokeLink(id)}
            onLoadOlder={() => void loadOlderLinks()}
          />
        </div>
      </main>
    </>
  );
}

function linkStatus(link: UploadLinkSummary, now: number) {
  if (link.revokedAt) return { label: "Revoked", variant: "destructive" } as const;
  if (new Date(link.expiresAt).getTime() > now) return { label: "Active", variant: "positive" } as const;
  return { label: "Expired", variant: "outline" } as const;
}

export function UploadLinkTable({ links, busy, hasMore, onRevoke, onLoadOlder, now = Date.now() }: {
  links?: UploadLinkSummary[];
  busy: boolean;
  hasMore: boolean;
  onRevoke: (id: string) => void;
  onLoadOlder: () => void;
  now?: number;
}) {
  const head = "h-auto px-2.5 py-1.75 text-xs font-medium text-muted-foreground";
  return (
    <Card className="gap-0 py-0" aria-label="Upload links">
      {links && links.length > 0 ? (
        <Table className="text-[0.8125rem]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={cn(head, "pl-4")}>Link</TableHead>
              <TableHead className={head}>Status</TableHead>
              <TableHead className={cn(head, "text-right max-md:hidden")}>Files</TableHead>
              <TableHead className={cn(head, "max-md:hidden")}>Expires</TableHead>
              <TableHead className={cn(head, "pr-4")}><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {links.map((link) => {
              const status = linkStatus(link, now);
              return (
                <TableRow key={link.id} className="border-border/60 hover:bg-transparent">
                  <TableCell className="w-full max-w-0 py-2 pr-2.5 pl-4">
                    <span className="block truncate font-medium">Created {formatDateTime(link.createdAt)}</span>
                    <span className="block truncate text-xs text-muted-foreground md:hidden">{countLabel(link.fileCount, "file")} · expires {formatDateTime(link.expiresAt)}</span>
                  </TableCell>
                  <TableCell className="px-2.5"><Badge variant={status.variant}>{status.label}</Badge></TableCell>
                  <TableCell className="px-2.5 text-right tabular-nums max-md:hidden">{link.fileCount}</TableCell>
                  <TableCell className="px-2.5 text-muted-foreground max-md:hidden">{formatDateTime(link.expiresAt)}</TableCell>
                  <TableCell className="py-2 pr-4 pl-2.5 text-right">
                    <span className="inline-flex items-center gap-1">
                      {link.fileCount > 0 ? <Button nativeButton={false} variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={`Download all ${countLabel(link.fileCount, "file")}`} render={<a href={`/api/upload-links/${link.id}/download`} />}><Download /></Button> : null}
                      {!link.revokedAt ? <Button type="button" variant="destructive-subtle" size="sm" onClick={() => onRevoke(link.id)} disabled={busy}>Revoke</Button> : null}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : (
        <p className="px-4 py-6 text-center text-[0.8125rem] text-muted-foreground">{links ? "No links yet. Create one to receive files." : "Loading links…"}</p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5 text-[0.8125rem] text-muted-foreground">
        <span>Older links cannot show their URL again. Make a new link instead.</span>
        {hasMore ? <Button type="button" variant="outline" size="sm" aria-label="Load older links" onClick={onLoadOlder} disabled={busy}>Load older</Button> : null}
      </div>
    </Card>
  );
}

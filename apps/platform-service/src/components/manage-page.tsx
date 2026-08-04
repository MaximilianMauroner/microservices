import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type {
  AdminAuditRecord,
  CatalogDocument,
  CatalogEntry,
  CatalogGroup,
  HistoryPartitionDocument,
  PrivateSnapshotDocument
} from "@tools-platform/domain";
import { AppShell } from "./app-shell.js";
import { AppSelect } from "./form-controls.js";
import { Alert } from "./ui/alert.js";
import { Badge } from "./ui/badge.js";
import { Button } from "./ui/button.js";
import { Card } from "./ui/card.js";
import { Checkbox } from "./ui/checkbox.js";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog.js";
import { Input } from "./ui/input.js";
import { Label } from "./ui/label.js";
import { Textarea } from "./ui/textarea.js";
import type { ManagePageData } from "../protected-data.js";

type RecordKey = `group:${string}` | `entry:${string}`;
type Mutation = { path: string; method: "POST" | "PATCH" | "DELETE"; body?: unknown };

export function ManagePage({ initial }: { initial: ManagePageData }) {
  const [catalog, setCatalog] = useState(initial.catalog);
  const [revision, setRevision] = useState(initial.revision);
  const [selected, setSelected] = useState<RecordKey | "new-group" | "new-entry">(firstRecord(initial.catalog));
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "group" | "entry">("all");
  const [lifecycle, setLifecycle] = useState("all");
  const [notice, setNotice] = useState<{ text: string; tone: "success" | "error" }>();
  const [deleteTarget, setDeleteTarget] = useState<{ kind: "groups" | "entries"; id: string; name: string }>();
  const groups = [...catalog.groups].sort(byOrderThenId);
  const entries = [...catalog.entries].sort(byOrderThenId);
  const records = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return [
      ...(kind !== "entry" ? groups.filter((group) => matchesRecord(`${group.id} ${group.name} ${group.description ?? ""}`, normalized, lifecycle === "all" || lifecycle === group.visibility)).map((group) => ({ key: `group:${group.id}` as RecordKey, kind: "group" as const, id: group.id, name: group.name, status: group.visibility })) : []),
      ...(kind !== "group" ? entries.filter((entry) => matchesRecord(`${entry.id} ${entry.name} ${entry.groupId}`, normalized, lifecycle === "all" || lifecycle === entry.lifecycle || lifecycle === entry.visibility)).map((entry) => ({ key: `entry:${entry.id}` as RecordKey, kind: "entry" as const, id: entry.id, name: entry.name, status: `${entry.lifecycle} ${entry.visibility}` })) : [])
    ];
  }, [entries, groups, kind, lifecycle, query]);

  async function mutate({ path, method, body }: Mutation): Promise<boolean> {
    setNotice(undefined);
    const headers = new Headers({ Accept: "application/json", "If-Match": `"${revision}"` });
    if (body !== undefined) headers.set("Content-Type", "application/json");
    try {
      const response = await fetch(path, { method, credentials: "same-origin", headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 409) throw new Error("The catalog changed elsewhere. Reload and review the latest revision.");
      if (!response.ok) throw new Error(typeof payload.message === "string" ? payload.message : `Change failed (HTTP ${response.status}).`);
      if (typeof payload.revision === "string") setRevision(payload.revision);
      setNotice({ text: payload.reload === false ? "Nothing changed." : "Saved. Refreshing the catalog…", tone: "success" });
      if (payload.reload !== false) window.location.reload();
      return true;
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "The catalog change failed.", tone: "error" });
      return false;
    }
  }

  async function createRecord(event: FormEvent<HTMLFormElement>, recordKind: "group" | "entry") {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    await mutate({ path: `/api/ops/${recordKind === "group" ? "groups" : "entries"}`, method: "POST", body });
  }

  const selectedGroup = selected.startsWith("group:") ? groups.find((group) => group.id === selected.slice(6)) : undefined;
  const selectedEntry = selected.startsWith("entry:") ? entries.find((entry) => entry.id === selected.slice(6)) : undefined;

  return (
    <>
      <AppShell active="manage" />
      <main id="main" className="app-page manage-page">
        <section className="app-heading" aria-labelledby="manage-title"><div><p className="eyebrow">Catalog administration</p><h1 id="manage-title">Keep the tools catalog accurate.</h1><p>Choose the record that needs attention, update it, and leave the operational history below for verification.</p></div><div className="app-heading__actions"><Badge variant="default">Revision {revision}</Badge><Button type="button" variant="default" size="sm" onClick={() => setSelected("new-entry")}>Add entry</Button><Button type="button" variant="ghost" size="sm" onClick={() => setSelected("new-group")}>Add group</Button><Button nativeButton={false} variant="ghost" size="sm" render={<a href="/manage/documents" />}>Documents</Button><Button nativeButton={false} variant="ghost" size="sm" render={<a href="/manage/status" />}>Private status</Button></div></section>
        {notice ? <Alert variant={notice.tone === "error" ? "destructive" : "default"} data-tone={notice.tone}>{notice.text}</Alert> : null}
        <section className="manage-metrics" aria-label="Catalog summary"><Metric label="Groups" value={groups.length} /><Metric label="Entries" value={entries.length} /><Metric label="Monitored" value={entries.filter((entry) => entry.monitor).length} /><Metric label="Open incidents" value={Object.values(initial.snapshot.state.monitors).filter((monitor) => monitor.openIncidentId).length} /></section>
        <section className="manage-records" aria-label="Catalog editor"><div><div className="manage-record-list"><Input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search records" aria-label="Search records" /><div className="manage-filter-row"><AppSelect value={kind} onValueChange={(value) => setKind(value as typeof kind)} aria-label="Filter by kind" options={[{ value: "all", label: "All kinds" }, { value: "group", label: "Groups" }, { value: "entry", label: "Entries" }]} /><AppSelect value={lifecycle} onValueChange={setLifecycle} aria-label="Filter by status" options={[{ value: "all", label: "All status" }, { value: "active", label: "Active" }, { value: "archived", label: "Archived" }, { value: "public", label: "Public" }, { value: "private", label: "Private" }]} /></div>{records.map((record) => <Button key={record.key} type="button" variant="ghost" size="sm" className={`manage-record${selected === record.key ? " is-active" : ""}`} onClick={() => setSelected(record.key)}><span>{record.name}</span><code>{record.kind}</code></Button>)}{records.length === 0 ? <p className="app-mono">No records match.</p> : null}</div></div><div>{selected === "new-group" ? <CreateGroup onSubmit={(event) => void createRecord(event, "group")} onCancel={() => setSelected(firstRecord(catalog))} /> : selected === "new-entry" ? <CreateEntry groups={groups} onSubmit={(event) => void createRecord(event, "entry")} onCancel={() => setSelected(firstRecord(catalog))} /> : selectedGroup ? <GroupEditor key={selectedGroup.id} group={selectedGroup} onMutate={mutate} onDelete={() => setDeleteTarget({ kind: "groups", id: selectedGroup.id, name: selectedGroup.name })} /> : selectedEntry ? <EntryEditor key={selectedEntry.id} entry={selectedEntry} groups={groups} snapshot={initial.snapshot} onMutate={mutate} onDelete={() => setDeleteTarget({ kind: "entries", id: selectedEntry.id, name: selectedEntry.name })} /> : <div className="app-empty">Select a catalog record.</div>}</div></section>
        <AdminCollections />
      </main>
      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open) setDeleteTarget(undefined); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.name ?? "record"}?</DialogTitle>
            <DialogDescription>This cannot be undone. Type the exact name to continue.</DialogDescription>
          </DialogHeader>
          {deleteTarget ? <DeleteForm target={deleteTarget} onCancel={() => setDeleteTarget(undefined)} onDelete={async () => { const deleted = await mutate({ path: `/api/ops/${deleteTarget.kind}/${deleteTarget.id}`, method: "DELETE" }); if (deleted) setDeleteTarget(undefined); return deleted; }} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function GroupEditor({ group, onMutate, onDelete }: { group: CatalogGroup; onMutate: (mutation: Mutation) => Promise<boolean>; onDelete: () => void }) {
  return <Card className="manage-editor"><EditorHeading type="Group" name={group.name} status={group.visibility === "public" ? "Public" : "Private"} /><form className="manage-form" onSubmit={(event) => { event.preventDefault(); const body = Object.fromEntries(new FormData(event.currentTarget).entries()); void onMutate({ path: `/api/ops/groups/${group.id}`, method: "PATCH", body }); }}><Label>Name<Input name="name" defaultValue={group.name} required /></Label><Label>Visibility<AppSelect name="visibility" defaultValue={group.visibility} options={[{ value: "public", label: "Public" }, { value: "private", label: "Private" }]} /></Label><Label className="manage-form__wide">Description<Textarea name="description" defaultValue={group.description ?? ""} /></Label><EditorActions onDelete={onDelete} /></form></Card>;
}

function EntryEditor({ entry, groups, snapshot, onMutate, onDelete }: { entry: CatalogEntry; groups: CatalogGroup[]; snapshot: PrivateSnapshotDocument; onMutate: (mutation: Mutation) => Promise<boolean>; onDelete: () => void }) {
  const monitor = snapshot.state.monitors[entry.id];
  const monitorStatus: string = monitor?.status ?? (entry.monitor ? "checking" : "unmonitored");
  return <Card className={`manage-editor${entry.lifecycle === "archived" ? " editor-card--archived" : ""}`}><EditorHeading type={entry.lifecycle === "archived" ? "Archived entry" : "Entry"} name={entry.name} status={monitorStatus === "unmonitored" ? "Not monitored" : monitorStatus === "up" ? "Operational" : monitorStatus === "paused" ? "Paused" : "Needs attention"} /><form className="manage-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); let links: unknown; try { links = JSON.parse(String(form.get("links") ?? "[]")); } catch { window.alert("Links JSON must be valid JSON."); return; } const monitorUrl = String(form.get("monitorUrl") ?? "").trim(); const body = { name: String(form.get("name") ?? ""), groupId: String(form.get("groupId") ?? ""), description: String(form.get("description") ?? ""), visibility: String(form.get("visibility") ?? "private"), privateNotes: String(form.get("privateNotes") ?? ""), links, monitor: monitorUrl ? { url: monitorUrl, tracking: String(form.get("monitorTracking") ?? "http"), enabled: form.get("monitorEnabled") === "on", scope: String(form.get("monitorScope") ?? "public") } : { url: "" } }; void onMutate({ path: `/api/ops/entries/${entry.id}`, method: "PATCH", body }); }}><Label>Name<Input name="name" defaultValue={entry.name} required /></Label><Label>Group<AppSelect name="groupId" defaultValue={entry.groupId} options={groups.map((group) => ({ value: group.id, label: group.name }))} /></Label><Label className="manage-form__wide">Description<Textarea name="description" defaultValue={entry.description} required /></Label><Label>Visibility<AppSelect name="visibility" defaultValue={entry.visibility} options={[{ value: "public", label: "Public" }, { value: "private", label: "Private" }]} /></Label><Label>Tracking source<AppSelect name="monitorTracking" defaultValue={entry.monitor?.tracking ?? "http"} options={[{ value: "http", label: "HTTP probe" }, { value: "heartbeat", label: "Inbound heartbeat" }]} /></Label><Label>Monitor URL<Input name="monitorUrl" type="url" defaultValue={entry.monitor?.url ?? ""} placeholder="https://example.test/health" /></Label><Label>Monitor scope<AppSelect name="monitorScope" defaultValue={entry.monitor?.scope ?? "public"} options={[{ value: "public", label: "Public" }, { value: "tailscale", label: "Tailscale" }]} /></Label><Label className="manage-checkbox"><Checkbox name="monitorEnabled" defaultChecked={entry.monitor?.enabled ?? false} /> Monitoring enabled</Label><Label className="manage-form__wide">Operator note<Textarea name="privateNotes" defaultValue={entry.privateNotes ?? ""} /></Label><div className="manage-links"><h3>Links JSON</h3><Textarea name="links" defaultValue={JSON.stringify(entry.links, null, 2)} spellCheck={false} /></div><EditorActions entry={entry} onMutate={onMutate} onDelete={onDelete} /></form></Card>;
}

function EditorActions({ entry, onMutate, onDelete }: { entry?: CatalogEntry; onMutate?: (mutation: Mutation) => Promise<boolean>; onDelete: () => void }) {
  const monitor = entry?.monitor;
  return <div className="manage-actions"><Button type="submit" variant="default">Save {entry ? "entry" : "group"}</Button>{entry && onMutate ? <><Button type="button" variant="ghost" onClick={() => void onMutate({ path: `/api/ops/entries/${entry.id}/reorder`, method: "POST", body: { direction: "up" } })}>Move up</Button><Button type="button" variant="ghost" onClick={() => void onMutate({ path: `/api/ops/entries/${entry.id}/reorder`, method: "POST", body: { direction: "down" } })}>Move down</Button>{monitor ? <Button type="button" variant="ghost" onClick={() => void onMutate({ path: `/api/ops/entries/${entry.id}/monitor/${monitor.paused ? "resume" : "pause"}`, method: "POST", body: {} })}>{monitor.paused ? "Resume checks" : "Pause checks"}</Button> : null}<Button type="button" variant="ghost" onClick={() => void onMutate({ path: `/api/ops/entries/${entry.id}/${entry.lifecycle === "archived" ? "restore" : "archive"}`, method: "POST", body: {} })}>{entry.lifecycle === "archived" ? "Restore" : "Archive"}</Button></> : null}<Button type="button" variant="destructive" onClick={onDelete}>Delete</Button></div>;
}

function CreateGroup({ onSubmit, onCancel }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void }) { return <Card className="manage-editor"><EditorHeading type="New record" name="Create group" status="Draft" /><form className="manage-form" onSubmit={onSubmit}><Label>Name<Input name="name" required /></Label><Label>Visibility<AppSelect name="visibility" defaultValue="private" options={[{ value: "private", label: "Private" }, { value: "public", label: "Public" }]} /></Label><Label className="manage-form__wide">Description<Textarea name="description" /></Label><div className="manage-actions"><Button type="submit" variant="default">Create group</Button><Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button></div></form></Card>; }
function CreateEntry({ groups, onSubmit, onCancel }: { groups: CatalogGroup[]; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void }) { return <Card className="manage-editor"><EditorHeading type="New record" name="Create entry" status="Draft" /><form className="manage-form" onSubmit={onSubmit}><Label>Name<Input name="name" required /></Label><Label>Group<AppSelect name="groupId" required placeholder="Choose a group" options={groups.map((group) => ({ value: group.id, label: group.name }))} /></Label><Label className="manage-form__wide">Description<Textarea name="description" required /></Label><Label>Visibility<AppSelect name="visibility" defaultValue="private" options={[{ value: "private", label: "Private" }, { value: "public", label: "Public" }]} /></Label><div className="manage-actions"><Button type="submit" variant="default">Create entry</Button><Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button></div></form></Card>; }

function DeleteForm({ target, onCancel, onDelete }: { target: { name: string }; onCancel: () => void; onDelete: () => Promise<boolean> }) { const [value, setValue] = useState(""); const [busy, setBusy] = useState(false); return <div><Label>Confirmation name<Input value={value} onChange={(event) => setValue(event.currentTarget.value)} autoComplete="off" /></Label><div className="manage-actions"><Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button><Button type="button" variant="destructive" disabled={value !== target.name || busy} onClick={() => { setBusy(true); void onDelete().then((deleted) => { if (!deleted) setBusy(false); }); }}>{busy ? "Deleting…" : "Delete permanently"}</Button></div></div>; }

function EditorHeading({ type, name, status }: { type: string; name: string; status: string }) { const variant = status === "Operational" || status === "Public" ? "default" : status === "Needs attention" ? "destructive" : status === "Paused" ? "secondary" : "outline"; return <div className="manage-editor__heading"><div><p className="eyebrow">{type}</p><h2>{name}</h2></div><Badge variant={variant}>{status}</Badge></div>; }
function Metric({ label, value }: { label: string; value: number }) { return <div className="manage-metric"><span>{label}</span><strong>{value}</strong></div>; }

function AdminCollections() {
  const [history, setHistory] = useState<HistoryPartitionDocument[]>([]);
  const [audit, setAudit] = useState<AdminAuditRecord[]>([]);
  useEffect(() => { void Promise.all([fetch("/api/ops/history?limit=5", { credentials: "same-origin" }).then((response) => response.ok ? response.json() as Promise<{ items: HistoryPartitionDocument[] }> : { items: [] }), fetch("/api/ops/audit?limit=8", { credentials: "same-origin" }).then((response) => response.ok ? response.json() as Promise<{ items: AdminAuditRecord[] }> : { items: [] })]).then(([historyPage, auditPage]) => { setHistory(historyPage.items); setAudit(auditPage.items); }); }, []);
  return <><section className="manage-collection"><div className="manage-collection__heading"><div><p className="eyebrow">Monitoring</p><h2>Check and incident history</h2></div><span className="app-mono">Protected data</span></div><div className="manage-list">{history.length === 0 ? <div className="app-empty">No history loaded yet.</div> : history.map((partition) => <div className="manage-history-day" key={partition.day}><h3>{partition.day}</h3><div className="manage-history-grid"><section><h4>Checks</h4><ul>{partition.observations.slice(0, 4).map((observation) => <li key={observation.id}><strong>{observation.monitorId ?? "Unknown monitor"}</strong> · {observation.success ? "Succeeded" : observation.errorCode ?? "Failed"} · {observation.latencyMs} ms</li>)}</ul></section><section><h4>Incidents</h4><ul>{partition.incidents.slice(0, 4).map((incident) => <li key={incident.id}><strong>{incident.monitorId}</strong> · {incident.resolvedAt ? "Resolved" : "Open"}</li>)}</ul></section></div></div>)}</div></section><section className="manage-collection"><div className="manage-collection__heading"><div><p className="eyebrow">Accountability</p><h2>Catalog audit</h2></div><span className="app-mono">Latest events</span></div><div className="manage-list">{audit.length === 0 ? <div className="app-empty">No audit events loaded yet.</div> : audit.map((record) => <div className="manage-audit-row" key={record.id}><div><strong>{record.action}</strong><div>{record.targetType}{record.targetId ? ` · ${record.targetId}` : ""}</div></div><div>{record.actor}<br />{formatDate(record.occurredAt)}</div><code>{record.catalogRevisionAfter}</code></div>)}</div></section></>;
}

function firstRecord(catalog: CatalogDocument): RecordKey | "new-group" { const group = [...catalog.groups].sort(byOrderThenId)[0]; return group ? `group:${group.id}` : "new-group"; }
function byOrderThenId<T extends { id: string; order: number }>(left: T, right: T) { return left.order - right.order || left.id.localeCompare(right.id); }
function matchesRecord(value: string, query: string, status: boolean) { return status && (!query || value.toLocaleLowerCase().includes(query)); }
function formatDate(value: string) { return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) + " UTC"; }

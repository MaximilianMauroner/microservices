import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import type {
  AdminAuditRecord,
  CatalogEntry,
  CatalogGroup,
  HistoryPartitionDocument
} from "@tools-platform/domain";
import { AppShell } from "../../components/app-shell.js";
import { AppSelect } from "../../components/form-controls.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card } from "../../components/ui/card.js";
import { Input } from "../../components/ui/input.js";
import type { ManagePageData } from "../../protected-data.js";

type RecordKey = `group:${string}` | `entry:${string}`;

export function ManagePage({ initial }: { initial: ManagePageData }) {
  const groups = useMemo(() => [...initial.catalog.groups].sort(byOrderThenId), [initial.catalog.groups]);
  const entries = useMemo(() => [...initial.catalog.entries].sort(byOrderThenId), [initial.catalog.entries]);
  const [selected, setSelected] = useState<RecordKey | undefined>(() => firstRecord(groups, entries));
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "group" | "entry">("all");
  const [lifecycle, setLifecycle] = useState("all");
  const records = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return [
      ...(kind !== "entry" ? groups.filter((group) => matchesRecord(`${group.id} ${group.name} ${group.description ?? ""}`, normalized, lifecycle === "all" || lifecycle === group.visibility)).map((group) => ({ key: `group:${group.id}` as RecordKey, kind: "group" as const, name: group.name })) : []),
      ...(kind !== "group" ? entries.filter((entry) => matchesRecord(`${entry.id} ${entry.name} ${entry.groupId}`, normalized, lifecycle === "all" || lifecycle === entry.lifecycle || lifecycle === entry.visibility)).map((entry) => ({ key: `entry:${entry.id}` as RecordKey, kind: "entry" as const, name: entry.name })) : [])
    ];
  }, [entries, groups, kind, lifecycle, query]);
  const selectedGroup = selected?.startsWith("group:") ? groups.find((group) => group.id === selected.slice(6)) : undefined;
  const selectedEntry = selected?.startsWith("entry:") ? entries.find((entry) => entry.id === selected.slice(6)) : undefined;

  return <>
    <AppShell active="manage" />
    <main id="main" className="app-page manage-page">
      <section className="app-heading" aria-labelledby="manage-title">
        <div><p className="eyebrow">Architecture as code</p><h1 id="manage-title">Tools architecture and monitoring.</h1><p>The catalog is read-only here. Change groups, visibility, links, and tracking in the repository.</p></div>
        <div className="app-heading__actions"><Badge variant="outline">Revision {initial.revision}</Badge><Button nativeButton={false} variant="ghost" size="sm" render={<Link to="/tools/private/money" preload="intent" />}>Money tracker</Button><Button nativeButton={false} variant="ghost" size="sm" render={<Link to="/manage/documents" preload="intent" />}>Documents</Button><Button nativeButton={false} variant="ghost" size="sm" render={<Link to="/manage/status" preload="intent" />}>Private status</Button></div>
      </section>
      <section className="manage-metrics" aria-label="Catalog summary"><Metric label="Groups" value={groups.length} /><Metric label="Entries" value={entries.length} /><Metric label="Monitored" value={entries.filter((entry) => entry.monitor).length} /><Metric label="Open incidents" value={Object.values(initial.snapshot.state.monitors).filter((monitor) => monitor.openIncidentId).length} /></section>
      <section className="manage-records" aria-label="Read-only catalog">
        <div><div className="manage-record-list"><Input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search records" aria-label="Search records" /><div className="manage-filter-row"><AppSelect value={kind} onValueChange={(value) => setKind(value as typeof kind)} aria-label="Filter by kind" options={[{ value: "all", label: "All kinds" }, { value: "group", label: "Groups" }, { value: "entry", label: "Entries" }]} /><AppSelect value={lifecycle} onValueChange={setLifecycle} aria-label="Filter by status" options={[{ value: "all", label: "All status" }, { value: "active", label: "Active" }, { value: "archived", label: "Archived" }, { value: "public", label: "Public" }, { value: "private", label: "Private" }]} /></div>{records.map((record) => <Button key={record.key} type="button" variant="ghost" size="sm" className={`manage-record${selected === record.key ? " is-active" : ""}`} onClick={() => setSelected(record.key)}><span>{record.name}</span><code>{record.kind}</code></Button>)}{records.length === 0 ? <p className="app-mono">No records match.</p> : null}</div></div>
        <div>{selectedGroup ? <GroupDetails group={selectedGroup} /> : selectedEntry ? <EntryDetails entry={selectedEntry} groups={groups} snapshot={initial.snapshot} /> : <div className="app-empty">Select a catalog record.</div>}</div>
      </section>
      <AdminCollections />
    </main>
  </>;
}

function GroupDetails({ group }: { group: CatalogGroup }) {
  return <Card className="manage-editor"><DetailsHeading type="Group" name={group.name} status={group.visibility} /><dl className="manage-details"><Detail label="Identifier" value={group.id} mono /><Detail label="Visibility" value={group.visibility} /><Detail label="Order" value={String(group.order)} /><Detail label="Description" value={group.description || "No description"} wide /></dl></Card>;
}

function EntryDetails({ entry, groups, snapshot }: { entry: CatalogEntry; groups: CatalogGroup[]; snapshot: ManagePageData["snapshot"] }) {
  const group = groups.find((candidate) => candidate.id === entry.groupId);
  const monitor = snapshot.state.monitors[entry.id];
  const state = monitor?.status ?? (entry.monitor ? "checking" : "unmonitored");
  return <Card className="manage-editor"><DetailsHeading type={entry.lifecycle === "archived" ? "Archived entry" : "Entry"} name={entry.name} status={state} /><dl className="manage-details"><Detail label="Identifier" value={entry.id} mono /><Detail label="Group" value={group?.name ?? entry.groupId} /><Detail label="Visibility" value={entry.visibility} /><Detail label="Lifecycle" value={entry.lifecycle} /><Detail label="Description" value={entry.description} wide />{entry.monitor ? <><Detail label="Tracking" value={entry.monitor.tracking === "heartbeat" ? "Inbound heartbeat" : "HTTP probe"} /><Detail label="Scope" value={entry.monitor.scope} /><Detail label="Checks" value={!entry.monitor.enabled ? "Disabled" : entry.monitor.paused ? "Paused" : "Enabled"} /><Detail label="Target" value={entry.monitor.url} mono wide /></> : <Detail label="Monitoring" value="Not configured" wide />}{entry.links.length ? <div className="manage-detail manage-detail--wide"><dt>Links</dt><dd className="manage-detail-links">{entry.links.map((link) => <a key={link.id} href={link.url} rel="noreferrer"><span>{link.label}</span><Badge variant="outline">{link.access}</Badge></a>)}</dd></div> : null}{entry.privateNotes ? <Detail label="Private notes" value={entry.privateNotes} wide /> : null}</dl></Card>;
}

function DetailsHeading({ type, name, status }: { type: string; name: string; status: string }) {
  const healthy = status === "up" || status === "public";
  const attention = status === "down" || status === "unavailable";
  return <div className="manage-editor__heading"><div><p className="eyebrow">{type}</p><h2>{name}</h2></div><Badge variant={attention ? "destructive" : healthy ? "default" : "outline"}>{status}</Badge></div>;
}

function Detail({ label, value, mono, wide }: { label: string; value: string; mono?: boolean; wide?: boolean }) {
  return <div className={`manage-detail${wide ? " manage-detail--wide" : ""}`}><dt>{label}</dt><dd className={mono ? "app-mono" : undefined}>{value}</dd></div>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="manage-metric"><span>{label}</span><strong>{value}</strong></div>; }

function AdminCollections() {
  const [history, setHistory] = useState<HistoryPartitionDocument[]>([]);
  const [audit, setAudit] = useState<AdminAuditRecord[]>([]);
  useEffect(() => { void Promise.all([fetch("/api/ops/history?limit=5", { credentials: "same-origin" }).then((response) => response.ok ? response.json() as Promise<{ items: HistoryPartitionDocument[] }> : { items: [] }), fetch("/api/ops/audit?limit=8", { credentials: "same-origin" }).then((response) => response.ok ? response.json() as Promise<{ items: AdminAuditRecord[] }> : { items: [] })]).then(([historyPage, auditPage]) => { setHistory(historyPage.items); setAudit(auditPage.items); }); }, []);
  return <><section className="manage-collection"><div className="manage-collection__heading"><div><p className="eyebrow">Monitoring</p><h2>Check and incident history</h2></div><span className="app-mono">Protected data</span></div><div className="manage-list">{history.length === 0 ? <div className="app-empty">No history loaded yet.</div> : history.map((partition) => <div className="manage-history-day" key={partition.day}><h3>{partition.day}</h3><div className="manage-history-grid"><section><h4>Checks</h4><ul>{partition.observations.slice(0, 4).map((observation) => <li key={observation.id}><strong>{observation.monitorId ?? "Unknown monitor"}</strong> · {observation.success ? "Succeeded" : observation.errorCode ?? "Failed"} · {observation.latencyMs} ms</li>)}</ul></section><section><h4>Incidents</h4><ul>{partition.incidents.slice(0, 4).map((incident) => <li key={incident.id}><strong>{incident.monitorId}</strong> · {incident.resolvedAt ? "Resolved" : "Open"}</li>)}</ul></section></div></div>)}</div></section><section className="manage-collection"><div className="manage-collection__heading"><div><p className="eyebrow">Accountability</p><h2>Catalog audit</h2></div><span className="app-mono">Latest events</span></div><div className="manage-list">{audit.length === 0 ? <div className="app-empty">No audit events loaded yet.</div> : audit.map((record) => <div className="manage-audit-row" key={record.id}><div><strong>{record.action}</strong><div>{record.targetType}{record.targetId ? ` · ${record.targetId}` : ""}</div></div><div>{record.actor}<br />{formatDate(record.occurredAt)}</div><code>{record.catalogRevisionAfter}</code></div>)}</div></section></>;
}

function firstRecord(groups: CatalogGroup[], entries: CatalogEntry[]): RecordKey | undefined { const group = groups[0]; if (group) return `group:${group.id}`; const entry = entries[0]; return entry ? `entry:${entry.id}` : undefined; }
function byOrderThenId<T extends { id: string; order: number }>(left: T, right: T) { return left.order - right.order || left.id.localeCompare(right.id); }
function matchesRecord(value: string, query: string, status: boolean) { return status && (!query || value.toLocaleLowerCase().includes(query)); }
function formatDate(value: string) { return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value)) + " UTC"; }

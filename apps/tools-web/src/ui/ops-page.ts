import type {
  AdminAuditRecord,
  CatalogEntry,
  CatalogGroup,
  HistoryPartitionDocument,
  PrivateSnapshotDocument
} from "@tools-platform/domain";
import { escapeHtml, jsonForDataAttribute } from "./escape.js";
import {
  byOrderThenId,
  formatTimestamp,
  pageShell,
  statusBadge,
  statusDetails
} from "./shared.js";

export interface OperationsPageModel {
  snapshot: PrivateSnapshotDocument;
  actor: string;
  revision: string;
  history?: OperationsHistoryPage;
  audit?: OperationsAuditPage;
}

export interface OperationsHistoryPage {
  items: HistoryPartitionDocument[];
  nextCursor: string | null;
}

export interface OperationsAuditPage {
  items: AdminAuditRecord[];
  nextCursor: string | null;
}

export function renderOperationsPage(model: OperationsPageModel): string {
  const { catalog, state } = model.snapshot;
  const groups = [...catalog.groups].sort(byOrderThenId);
  const entries = [...catalog.entries].sort(byOrderThenId);
  const body = `<header class="site-header site-header--ops">
      <div class="wrap masthead">
        <a class="wordmark" href="/" aria-label="Public tools directory">Tools<span>.</span></a>
        <p><strong>Operations</strong> <span class="environment">Access protected</span></p>
        <p class="actor">Signed in as ${escapeHtml(model.actor)}</p>
      </div>
    </header>
    <main id="main" class="wrap ops" data-ops-root data-revision="${escapeHtml(model.revision)}">
      <section class="ops-heading" aria-labelledby="ops-title">
        <div>
          <p class="eyebrow">Catalog administration</p>
          <h1 id="ops-title">Tools operations</h1>
          <p>Edit the curated directory and monitor settings. Changes use optimistic concurrency and are never retried automatically.</p>
        </div>
        <dl class="snapshot-meta">
          <div><dt>Catalog revision</dt><dd data-current-revision>${escapeHtml(model.revision)}</dd></div>
          <div><dt>Snapshot</dt><dd><time datetime="${escapeHtml(model.snapshot.generatedAt)}">${formatTimestamp(model.snapshot.generatedAt)}</time></dd></div>
          <div><dt>Open incidents</dt><dd>${state.incidents.filter((incident) => incident.resolvedAt === null).length}</dd></div>
        </dl>
      </section>

      <div class="notice notice--pending" role="status" aria-live="polite" data-mutation-status hidden></div>

      <section class="ops-section" aria-labelledby="groups-title">
        <div class="section-heading">
          <div><p class="eyebrow">Structure</p><h2 id="groups-title">Groups</h2></div>
          <button class="button button--primary" type="button" data-reveal="new-group">Add group</button>
        </div>
        ${renderNewGroup()}
        <div class="ops-list">${groups.map(renderGroupEditor).join("")}</div>
      </section>

      <section class="ops-section" aria-labelledby="entries-title">
        <div class="section-heading">
          <div><p class="eyebrow">Directory</p><h2 id="entries-title">Entries</h2></div>
          <button class="button button--primary" type="button" data-reveal="new-entry">Add entry</button>
        </div>
        ${renderNewEntry(groups)}
        <div class="ops-list">${entries.length === 0 ? '<p class="empty-row">No entries in the catalog.</p>' : entries.map((entry) => renderEntryEditor(entry, groups, model.snapshot)).join("")}</div>
      </section>

      ${renderHistorySection(model.history)}
      ${renderAuditSection(model.audit)}
    </main>
    ${renderDeleteDialog()}
    ${renderConflictDialog()}`;

  return pageShell({
    title: "Operations — Tools",
    description: "Protected Tools Platform catalog administration.",
    body,
    operations: true
  });
}

export function renderOperationsHistoryPage(
  page: OperationsHistoryPage
): string {
  if (page.items.length === 0) {
    return '<p class="empty-row" data-collection-empty>No check or incident history is available yet.</p>';
  }
  return page.items.map(renderHistoryPartition).join("");
}

export function renderOperationsAuditPage(page: OperationsAuditPage): string {
  if (page.items.length === 0) {
    return '<li class="empty-row" data-collection-empty>No catalog audit events are available yet.</li>';
  }
  return page.items.map(renderAuditRecord).join("");
}

function renderHistorySection(page: OperationsHistoryPage | undefined): string {
  return `<section class="ops-section" aria-labelledby="history-title" data-ops-collection="history" data-endpoint="/api/ops/history"${page?.nextCursor ? ` data-next-cursor="${escapeHtml(page.nextCursor)}"` : ""}>
        <div class="section-heading">
          <div><p class="eyebrow">Monitoring</p><h2 id="history-title">Check & incident history</h2></div>
        </div>
        <p class="collection-state" role="status" aria-live="polite" data-collection-loading${page ? " hidden" : ""}>Loading protected history…</p>
        <div class="notice notice--error" role="alert" data-collection-error hidden>
          <span data-collection-error-message>History could not be loaded.</span>
          <button class="button" type="button" data-collection-retry>Try again</button>
        </div>
        <div class="timeline" data-collection-items>${page ? renderOperationsHistoryPage(page) : ""}</div>
        <button class="button" type="button" data-collection-more${page?.nextCursor ? "" : " hidden"}>Load older history</button>
      </section>`;
}

function renderAuditSection(page: OperationsAuditPage | undefined): string {
  return `<section class="ops-section" aria-labelledby="audit-title" data-ops-collection="audit" data-endpoint="/api/ops/audit"${page?.nextCursor ? ` data-next-cursor="${escapeHtml(page.nextCursor)}"` : ""}>
        <div class="section-heading">
          <div><p class="eyebrow">Accountability</p><h2 id="audit-title">Catalog audit</h2></div>
        </div>
        <p class="collection-state" role="status" aria-live="polite" data-collection-loading${page ? " hidden" : ""}>Loading protected audit events…</p>
        <div class="notice notice--error" role="alert" data-collection-error hidden>
          <span data-collection-error-message>Audit events could not be loaded.</span>
          <button class="button" type="button" data-collection-retry>Try again</button>
        </div>
        <ol class="audit-list" data-collection-items>${page ? renderOperationsAuditPage(page) : ""}</ol>
        <button class="button" type="button" data-collection-more${page?.nextCursor ? "" : " hidden"}>Load older audit events</button>
      </section>`;
}

function renderHistoryPartition(partition: HistoryPartitionDocument): string {
  const observations =
    partition.observations.length === 0
      ? '<p class="empty-row">No raw checks retained for this day.</p>'
      : `<ul class="history-list" role="list">${partition.observations
          .map(
            (observation) => `<li>
              <div><strong>${escapeHtml(observation.monitorId)}</strong><span>Observation ${escapeHtml(observation.id)} · Run ${escapeHtml(observation.runId)}</span></div>
              <span class="status ${observation.success ? "status--up" : "status--down"}">${observation.success ? "Succeeded" : escapeHtml(observation.errorCode ?? "Failed")}</span>
              <span>${observation.latencyMs} ms${observation.statusCode === null ? "" : ` · HTTP ${observation.statusCode}`}</span>
              <time datetime="${escapeHtml(observation.checkedAt)}">${formatTimestamp(observation.checkedAt)}</time>
            </li>`
          )
          .join("")}</ul>`;
  const incidents =
    partition.incidents.length === 0
      ? '<p class="empty-row">No incidents recorded for this day.</p>'
      : `<ul class="incident-list" role="list">${partition.incidents
          .map(
            (incident) => `<li>
              <strong>${escapeHtml(incident.monitorId)}</strong>
              <span>${incident.resolvedAt === null ? "Open incident" : "Resolved incident"}</span>
              <time datetime="${escapeHtml(incident.startedAt)}">Opened ${formatTimestamp(incident.startedAt)}</time>
              ${incident.resolvedAt === null ? "" : `<time datetime="${escapeHtml(incident.resolvedAt)}">Resolved ${formatTimestamp(incident.resolvedAt)}</time>`}
            </li>`
          )
          .join("")}</ul>`;
  return `<article class="history-day">
        <h3><time datetime="${escapeHtml(partition.day)}">${escapeHtml(partition.day)}</time></h3>
        <div class="history-columns">
          <section aria-label="Checks for ${escapeHtml(partition.day)}"><h4>Checks</h4>${observations}</section>
          <section aria-label="Incidents for ${escapeHtml(partition.day)}"><h4>Incidents</h4>${incidents}</section>
        </div>
      </article>`;
}

function renderAuditRecord(record: AdminAuditRecord): string {
  return `<li class="audit-record">
      <div><strong>${escapeHtml(record.action)}</strong><span>${escapeHtml(record.targetType)}${record.targetId ? ` · ${escapeHtml(record.targetId)}` : ""}</span></div>
      <div><span>${escapeHtml(record.actor)}</span><time datetime="${escapeHtml(record.occurredAt)}">${formatTimestamp(record.occurredAt)}</time></div>
      <code title="Catalog revision">${escapeHtml(record.catalogRevisionAfter)}</code>
    </li>`;
}

function renderGroupEditor(group: CatalogGroup): string {
  return `<article class="editor-card">
          <div class="editor-card__heading">
            <div><p class="record-type">Group</p><h3>${escapeHtml(group.name)}</h3></div>
            <div class="order-controls" aria-label="Reorder ${escapeHtml(group.name)}">
              <button class="icon-button" type="button" data-json-action="/api/ops/groups/${escapeHtml(group.id)}/reorder" data-json-method="POST" data-json-body="${jsonForDataAttribute({ direction: "up" })}" aria-label="Move ${escapeHtml(group.name)} up">↑</button>
              <button class="icon-button" type="button" data-json-action="/api/ops/groups/${escapeHtml(group.id)}/reorder" data-json-method="POST" data-json-body="${jsonForDataAttribute({ direction: "down" })}" aria-label="Move ${escapeHtml(group.name)} down">↓</button>
            </div>
          </div>
          <form class="edit-form" data-json-form action="/api/ops/groups/${escapeHtml(group.id)}" method="post">
            <input type="hidden" name="_method" value="PATCH">
            <label>Name <input name="name" required value="${escapeHtml(group.name)}"></label>
            <label>Description <input name="description" value="${escapeHtml(group.description ?? "")}"></label>
            <label>Visibility
              <select name="visibility">
                ${option("public", group.visibility)}
                ${option("private", group.visibility)}
              </select>
            </label>
            <div class="form-actions">
              <button class="button" type="submit">Save group</button>
              <button class="button button--danger" type="button" data-delete-action="/api/ops/groups/${escapeHtml(group.id)}" data-delete-name="${escapeHtml(group.name)}">Delete</button>
            </div>
          </form>
        </article>`;
}

function renderEntryEditor(
  entry: CatalogEntry,
  groups: CatalogGroup[],
  snapshot: PrivateSnapshotDocument
): string {
  const monitor = snapshot.state.monitors[entry.id];
  const publicStatus = monitor
    ? {
        monitorId: monitor.monitorId,
        status: monitor.status,
        checkedAt: monitor.latestObservation?.checkedAt ?? null,
        latencyMs: monitor.latestObservation?.latencyMs ?? null,
        statusCode: monitor.latestObservation?.statusCode ?? null
      }
    : entry.monitor
      ? {
          monitorId: entry.id,
          status: entry.monitor.scope === "tailscale" ? "unavailable" as const : "checking" as const,
          checkedAt: null,
          latencyMs: null,
          statusCode: null
        }
      : undefined;
  const monitorAction =
    entry.monitor && (entry.monitor.paused || monitor?.status === "paused")
      ? { label: "Resume checks", action: "resume" }
      : { label: "Pause checks", action: "pause" };
  return `<article class="editor-card${entry.lifecycle === "archived" ? " editor-card--archived" : ""}">
          <div class="editor-card__heading">
            <div>
              <p class="record-type">${entry.lifecycle === "archived" ? "Archived entry" : "Entry"}</p>
              <h3>${escapeHtml(entry.name)}</h3>
            </div>
            <div>${statusBadge(publicStatus)}<p class="status-detail">${statusDetails(publicStatus)}</p></div>
          </div>
          <form class="edit-form edit-form--entry" data-json-form action="/api/ops/entries/${escapeHtml(entry.id)}" method="post">
            <input type="hidden" name="_method" value="PATCH">
            <label>Name <input name="name" required value="${escapeHtml(entry.name)}"></label>
            <label>Group
              <select name="groupId">${groups.map((group) => `<option value="${escapeHtml(group.id)}"${group.id === entry.groupId ? " selected" : ""}>${escapeHtml(group.name)}</option>`).join("")}</select>
            </label>
            <label class="span-all">Description <textarea name="description" rows="2" required>${escapeHtml(entry.description)}</textarea></label>
            <label>Visibility
              <select name="visibility">${option("public", entry.visibility)}${option("private", entry.visibility)}</select>
            </label>
            <label>Monitor URL <input name="monitor.url" type="url" value="${escapeHtml(entry.monitor?.url ?? "")}" placeholder="https://example.test/health"></label>
            <label>Monitor scope
              <select name="monitor.scope">${option("public", entry.monitor?.scope ?? "public")}${option("tailscale", entry.monitor?.scope ?? "public")}</select>
            </label>
            <label class="checkbox"><input name="monitor.enabled" type="checkbox"${entry.monitor?.enabled ? " checked" : ""}> Monitoring enabled</label>
            <label class="span-all">Operator note <textarea name="privateNotes" rows="2">${escapeHtml(entry.privateNotes ?? "")}</textarea></label>
            <label class="span-all">Links JSON <textarea name="links" rows="4" spellcheck="false">${escapeHtml(JSON.stringify(entry.links, null, 2))}</textarea></label>
            <div class="form-actions span-all">
              <button class="button" type="submit">Save entry</button>
              <button class="button" type="button" data-json-action="/api/ops/entries/${escapeHtml(entry.id)}/reorder" data-json-method="POST" data-json-body="${jsonForDataAttribute({ direction: "up" })}">Move up</button>
              <button class="button" type="button" data-json-action="/api/ops/entries/${escapeHtml(entry.id)}/reorder" data-json-method="POST" data-json-body="${jsonForDataAttribute({ direction: "down" })}">Move down</button>
              ${entry.monitor ? `<button class="button" type="button" data-json-action="/api/ops/entries/${escapeHtml(entry.id)}/monitor/${monitorAction.action}" data-json-method="POST" data-json-body="{}">${monitorAction.label}</button>` : ""}
              <button class="button" type="button" data-json-action="/api/ops/entries/${escapeHtml(entry.id)}/${entry.lifecycle === "archived" ? "restore" : "archive"}" data-json-method="POST" data-json-body="{}">${entry.lifecycle === "archived" ? "Restore" : "Archive"}</button>
              <button class="button button--danger" type="button" data-delete-action="/api/ops/entries/${escapeHtml(entry.id)}" data-delete-name="${escapeHtml(entry.name)}">Delete</button>
            </div>
          </form>
        </article>`;
}

function renderNewGroup(): string {
  return `<form class="edit-form create-form" id="new-group" data-json-form action="/api/ops/groups" method="post" hidden>
          <label>Name <input name="name" required></label>
          <label>Description <input name="description"></label>
          <label>Visibility <select name="visibility"><option value="private">Private</option><option value="public">Public</option></select></label>
          <div class="form-actions"><button class="button button--primary" type="submit">Create group</button><button class="button" type="button" data-hide="new-group">Cancel</button></div>
        </form>`;
}

function renderNewEntry(groups: CatalogGroup[]): string {
  return `<form class="edit-form create-form" id="new-entry" data-json-form action="/api/ops/entries" method="post" hidden>
          <label>Name <input name="name" required></label>
          <label>Group <select name="groupId" required><option value="">Choose a group</option>${groups.map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)}</option>`).join("")}</select></label>
          <label class="span-all">Description <textarea name="description" rows="2" required></textarea></label>
          <label>Visibility <select name="visibility"><option value="private">Private</option><option value="public">Public</option></select></label>
          <div class="form-actions span-all"><button class="button button--primary" type="submit">Create entry</button><button class="button" type="button" data-hide="new-entry">Cancel</button></div>
        </form>`;
}

function renderDeleteDialog(): string {
  return `<dialog class="modal" data-delete-dialog aria-labelledby="delete-title">
      <form method="dialog" data-delete-form>
        <p class="eyebrow">Permanent action</p>
        <h2 id="delete-title">Delete <span data-delete-label></span>?</h2>
        <p>This cannot be undone. Type the exact name to continue.</p>
        <label>Confirmation name <input data-delete-confirmation autocomplete="off"></label>
        <div class="form-actions">
          <button class="button" value="cancel">Cancel</button>
          <button class="button button--danger" type="submit" value="confirm" data-delete-submit disabled>Delete permanently</button>
        </div>
      </form>
    </dialog>`;
}

function renderConflictDialog(): string {
  return `<dialog class="modal" data-conflict-dialog aria-labelledby="conflict-title">
      <div>
        <p class="eyebrow">Update conflict</p>
        <h2 id="conflict-title">The catalog changed elsewhere</h2>
        <p>Your change was not applied. Reload the latest catalog, review it, and submit again.</p>
        <p data-conflict-detail></p>
        <div class="form-actions">
          <button class="button button--primary" type="button" data-conflict-reload>Reload latest catalog</button>
          <button class="button" type="button" data-conflict-dismiss>Stay on this page</button>
        </div>
      </div>
    </dialog>`;
}

function option(value: string, selected: string): string {
  const label = value.charAt(0).toUpperCase() + value.slice(1);
  return `<option value="${value}"${value === selected ? " selected" : ""}>${label}</option>`;
}

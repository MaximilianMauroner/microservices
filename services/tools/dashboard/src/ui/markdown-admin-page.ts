import type {
  MarkdownAdminDocument,
  MarkdownAdminSnapshot
} from "../markdown-admin.js";
import { escapeHtml } from "./escape.js";
import { formatTimestamp, pageShell } from "./shared.js";

export interface MarkdownAdminPageModel {
  snapshot: MarkdownAdminSnapshot;
  actor: string;
  publicOrigin: string;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export function renderMarkdownAdminPage(
  model: MarkdownAdminPageModel,
): string {
  const { documents } = model.snapshot;
  const now = model.snapshot.generatedAt;
  const generatedAt = new Date(now).toISOString();
  const editedRecently = documents.filter(
    (document) => document.updatedAt >= now - DAY,
  ).length;
  const checkpointVersions = documents.reduce(
    (total, document) => total + document.checkpointCount,
    0,
  );
  const checkpointedDocuments = documents.filter(
    (document) => document.checkpointCount > 0,
  ).length;
  const nextToExpire = [...documents].sort(
    (left, right) => left.expiresAt - right.expiresAt,
  )[0];
  const nextExpiry = nextToExpire
    ? formatRemaining(nextToExpire.expiresAt, now)
    : "—";
  const nextExpiryTone = nextToExpire && nextToExpire.expiresAt - now <= DAY
    ? " dashboard-metric--attention"
    : "";

  const body = `<main id="main" class="wrap ops markdown-admin" data-markdown-admin data-generated-at="${now}">
      <nav class="admin-breadcrumbs" aria-label="Breadcrumb">
        <a href="/manage">Manage</a><span aria-hidden="true">/</span><span>Markdown Share</span>
      </nav>

      <section class="markdown-admin-heading" aria-labelledby="markdown-admin-title">
        <div class="markdown-admin-heading__copy">
          <p class="eyebrow">Private inventory</p>
          <h1 id="markdown-admin-title">Document inventory</h1>
          <p class="admin-lede">See what is active, recently edited, checkpointed, and approaching expiry across Markdown Share.</p>
          <div class="form-actions admin-heading-actions">
            <a class="button button--primary button-link" href="${escapeHtml(model.publicOrigin)}" target="_blank" rel="noreferrer">New document <span aria-hidden="true">↗</span></a>
            <a class="button button-link" href="/manage">Catalog administration</a>
          </div>
        </div>
        <aside class="inventory-state" aria-label="Inventory status">
          <span class="inventory-state__signal"><span aria-hidden="true"></span>Inventory current</span>
          <span>Synced <time datetime="${escapeHtml(generatedAt)}">${formatTimestamp(generatedAt)}</time></span>
          <span>Access protected · ${escapeHtml(model.actor)}</span>
        </aside>
      </section>

      <section class="dashboard-metrics" aria-label="Inventory overview">
        ${renderMetric("Active documents", String(documents.length), model.snapshot.truncated ? "Showing the first 200" : "Complete inventory")}
        ${renderMetric("Edited in 24 hours", String(editedRecently), editedRecently === 1 ? "document with recent activity" : "documents with recent activity")}
        ${renderMetric("Checkpoint versions", String(checkpointVersions), `${checkpointedDocuments} of ${documents.length} documents protected`)}
        ${renderMetric("Next expiry", nextExpiry, nextToExpire ? nextToExpire.filename : "No active documents", nextExpiryTone)}
      </section>

      <section class="ops-section markdown-documents" aria-labelledby="documents-title">
        <div class="section-heading markdown-section-heading">
          <div>
            <p class="eyebrow">Inventory</p>
            <h2 id="documents-title">Documents</h2>
          </div>
          <p class="collection-state" data-document-count aria-live="polite">${documents.length} ${documents.length === 1 ? "document" : "documents"}</p>
        </div>
        ${model.snapshot.truncated ? '<div class="notice notice--pending" role="status">Showing the first 200 active documents. Refine the upstream query to inspect older results.</div>' : ""}
        ${documents.length === 0 ? '<p class="empty-row markdown-empty">No active Markdown documents.</p>' : renderInventory(documents, model.publicOrigin, now)}
      </section>
    </main>`;

  return pageShell({
    title: "Documents · Mauroner Tools",
    description: "Protected Markdown Share document inventory.",
    body,
    privatePage: true,
    markdownAdmin: true,
    active: "manage",
  });
}

function renderMetric(
  label: string,
  value: string,
  detail: string,
  modifier = "",
): string {
  return `<article class="dashboard-metric${modifier}">
          <p>${escapeHtml(label)}</p>
          <strong>${escapeHtml(value)}</strong>
          <span>${escapeHtml(detail)}</span>
        </article>`;
}

function renderInventory(
  documents: MarkdownAdminDocument[],
  publicOrigin: string,
  now: number,
): string {
  return `<div class="document-toolbar" role="group" aria-label="Filter documents">
          <label class="document-search">
            <span>Search</span>
            <input type="search" placeholder="Filename…" autocomplete="off" data-document-search>
          </label>
          <label>
            <span>Checkpoints</span>
            <select data-document-checkpoints>
              <option value="all">All documents</option>
              <option value="with">With checkpoints</option>
              <option value="without">Without checkpoints</option>
            </select>
          </label>
          <label>
            <span>Expiry</span>
            <select data-document-expiry>
              <option value="all">Any time</option>
              <option value="24">Next 24 hours</option>
              <option value="72">Next 3 days</option>
              <option value="168">Next 7 days</option>
            </select>
          </label>
          <label>
            <span>Sort by</span>
            <select data-document-sort>
              <option value="updated-desc">Recently edited</option>
              <option value="expiry-asc">Expiring soon</option>
              <option value="created-desc">Newest created</option>
              <option value="name-asc">Filename A–Z</option>
            </select>
          </label>
        </div>
        <div class="document-table" role="table" aria-label="Active Markdown documents">
          <div class="document-table__header" role="row">
            <span role="columnheader">Document</span>
            <span role="columnheader">Last activity</span>
            <span role="columnheader">Checkpoints</span>
            <span role="columnheader">Expires</span>
            <span role="columnheader" class="visually-hidden">Actions</span>
          </div>
          <div class="document-table__body" role="rowgroup" data-document-list>
            ${documents.map((document) => renderDocument(document, publicOrigin, now)).join("")}
          </div>
        </div>
        <div class="markdown-empty" data-document-empty hidden>No documents match these filters.</div>`;
}

function renderDocument(
  document: MarkdownAdminDocument,
  publicOrigin: string,
  now: number,
): string {
  const createdAt = new Date(document.createdAt).toISOString();
  const updatedAt = new Date(document.updatedAt).toISOString();
  const expiresAt = new Date(document.expiresAt).toISOString();
  const href = new URL(
    `/markdown/d/${encodeURIComponent(document.filename)}--${encodeURIComponent(document.token)}`,
    publicOrigin,
  ).toString();
  const expiryRemaining = document.expiresAt - now;
  const expiryTone = expiryRemaining <= DAY
    ? " document-expiry--attention"
    : expiryRemaining <= 3 * DAY
      ? " document-expiry--soon"
      : "";
  const checkpointLabel = document.checkpointCount === 1
    ? "1 version"
    : `${document.checkpointCount} versions`;

  return `<div class="document-row" role="row" data-document-row data-filename="${escapeHtml(document.filename.toLocaleLowerCase())}" data-created="${document.createdAt}" data-updated="${document.updatedAt}" data-expires="${document.expiresAt}" data-checkpoints="${document.checkpointCount}">
              <div class="document-cell document-cell--identity" role="cell">
                <span class="document-type" aria-hidden="true"></span>
                <div>
                  <h3><a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(document.filename)}</a></h3>
                  <span>Created <time datetime="${escapeHtml(createdAt)}" title="${formatTimestamp(createdAt)}">${formatRelativePast(document.createdAt, now)}</time></span>
                </div>
              </div>
              <div class="document-cell document-cell--activity" role="cell" data-label="Last activity">
                <strong><time datetime="${escapeHtml(updatedAt)}" title="${formatTimestamp(updatedAt)}">${formatRelativePast(document.updatedAt, now)}</time></strong>
                <span>${formatTimestamp(updatedAt)}</span>
              </div>
              <div class="document-cell document-cell--checkpoint" role="cell" data-label="Checkpoints">
                <span class="checkpoint-badge${document.checkpointCount === 0 ? " checkpoint-badge--empty" : ""}">${escapeHtml(checkpointLabel)}</span>
              </div>
              <div class="document-cell document-cell--expiry${expiryTone}" role="cell" data-label="Expires">
                <strong><time datetime="${escapeHtml(expiresAt)}">${formatRemaining(document.expiresAt, now)}</time></strong>
                <span>${formatTimestamp(expiresAt)}</span>
              </div>
              <div class="document-cell document-cell--actions" role="cell">
                <button class="button document-copy" type="button" data-copy-link="${escapeHtml(href)}" aria-label="Copy link to ${escapeHtml(document.filename)}">Copy link</button>
                <a class="button button-link document-open" href="${escapeHtml(href)}" target="_blank" rel="noreferrer" aria-label="Open ${escapeHtml(document.filename)} in a new tab">Open <span aria-hidden="true">↗</span></a>
              </div>
            </div>`;
}

function formatRelativePast(value: number, now: number): string {
  const elapsed = Math.max(0, now - value);
  const minutes = Math.floor(elapsed / (60 * 1000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(elapsed / HOUR);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(elapsed / DAY);
  return `${days}d ago`;
}

function formatRemaining(expiresAt: number, now: number): string {
  const remaining = Math.max(0, expiresAt - now);
  const minutes = Math.floor(remaining / (60 * 1000));
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(remaining / HOUR);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.floor(hours / 24);
  return `in ${days}d ${hours % 24}h`;
}

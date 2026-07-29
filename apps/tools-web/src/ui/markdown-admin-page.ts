import type { MarkdownAdminSnapshot } from "../markdown-admin.js";
import { escapeHtml } from "./escape.js";
import { formatTimestamp, pageShell } from "./shared.js";

export interface MarkdownAdminPageModel {
  snapshot: MarkdownAdminSnapshot;
  actor: string;
  publicOrigin: string;
}

export function renderMarkdownAdminPage(
  model: MarkdownAdminPageModel,
): string {
  const { documents } = model.snapshot;
  const generatedAt = new Date(model.snapshot.generatedAt).toISOString();
  const body = `<main id="main" class="wrap ops markdown-admin">
      <section class="ops-heading" aria-labelledby="markdown-admin-title">
        <div>
          <p class="eyebrow">Private inventory</p>
          <h1 id="markdown-admin-title">Markdown documents</h1>
          <p><span class="environment">Cloudflare Access protected</span> · Signed in as ${escapeHtml(model.actor)}. Links are visible only in this authenticated view.</p>
          <div class="form-actions admin-heading-actions">
            <a class="button button-link" href="/manage">Catalog administration</a>
            <a class="button button--primary button-link" href="${escapeHtml(model.publicOrigin)}" target="_blank" rel="noreferrer">New document <span aria-hidden="true">↗</span></a>
          </div>
        </div>
        <dl class="snapshot-meta">
          <div><dt>Active documents</dt><dd>${documents.length}</dd></div>
          <div><dt>Generated</dt><dd><time datetime="${escapeHtml(generatedAt)}">${formatTimestamp(generatedAt)}</time></dd></div>
          <div><dt>Result limit</dt><dd>${model.snapshot.truncated ? "200+" : "Complete"}</dd></div>
        </dl>
      </section>

      <section class="ops-section markdown-documents" aria-labelledby="documents-title">
        <div class="section-heading">
          <div><p class="eyebrow">Convex</p><h2 id="documents-title">Active documents</h2></div>
          <p class="collection-state">Newest edits first · content remains private</p>
        </div>
        ${model.snapshot.truncated ? '<div class="notice notice--pending" role="status">Showing the first 200 active documents.</div>' : ""}
        ${documents.length === 0 ? '<p class="empty-row markdown-empty">No active Markdown documents.</p>' : `<div class="markdown-document-list">${documents.map((document) => renderDocument(document, model.publicOrigin, model.snapshot.generatedAt)).join("")}</div>`}
      </section>
    </main>`;

  return pageShell({
    title: "Markdown documents — Tools",
    description: "Protected Markdown Share document inventory.",
    body,
    privatePage: true,
    active: "manage",
  });
}

function renderDocument(
  document: MarkdownAdminSnapshot["documents"][number],
  publicOrigin: string,
  now: number,
): string {
  const createdAt = new Date(document.createdAt).toISOString();
  const updatedAt = new Date(document.updatedAt).toISOString();
  const expiresAt = new Date(document.expiresAt).toISOString();
  const href = new URL(
    `/d/${encodeURIComponent(document.filename)}--${encodeURIComponent(document.token)}`,
    publicOrigin,
  ).toString();
  return `<article class="markdown-document-card">
        <div class="markdown-document-card__name">
          <h3>${escapeHtml(document.filename)}</h3>
          <span>Updated <time datetime="${escapeHtml(updatedAt)}">${formatTimestamp(updatedAt)}</time></span>
        </div>
        <dl class="markdown-document-meta">
          <div><dt>Checkpoints</dt><dd>${document.checkpointCount}</dd></div>
          <div><dt>Created</dt><dd><time datetime="${escapeHtml(createdAt)}">${formatTimestamp(createdAt)}</time></dd></div>
          <div><dt>Expires</dt><dd><time datetime="${escapeHtml(expiresAt)}">${formatRemaining(document.expiresAt, now)}</time></dd></div>
        </dl>
        <a class="button button-link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer" aria-label="Open ${escapeHtml(document.filename)} in a new tab">Open <span aria-hidden="true">↗</span></a>
      </article>`;
}

function formatRemaining(expiresAt: number, now: number): string {
  const remaining = Math.max(0, expiresAt - now);
  const hours = Math.floor(remaining / (60 * 60 * 1000));
  const days = Math.floor(hours / 24);
  const remainderHours = hours % 24;
  return days > 0 ? `in ${days}d ${remainderHours}h` : `in ${remainderHours}h`;
}

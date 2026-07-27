import type {
  PublicCatalogEntry,
  PublicGroup,
  PublicSnapshotDocument
} from "@tools-platform/domain";
import { escapeHtml, safeHttpUrl } from "./escape.js";
import {
  byOrderThenId,
  formatTimestamp,
  pageShell,
  statusBadge,
  statusDetails
} from "./shared.js";

export function renderPublicPage(snapshot: PublicSnapshotDocument): string {
  const groups = [...snapshot.groups].sort(byOrderThenId);
  const entries = [...snapshot.entries].sort(byOrderThenId);
  const body = `<header class="site-header">
      <div class="wrap masthead">
        <a class="wordmark" href="/" aria-label="Tools home">Tools<span>.</span></a>
        <p>Small utilities and operational services by Mauroner</p>
        <a class="quiet-link" href="/ops">Operator sign-in</a>
      </div>
    </header>
    <main id="main" class="wrap">
      <section class="hero" aria-labelledby="directory-title">
        <p class="eyebrow">tools.mauroner.net</p>
        <h1 id="directory-title">Useful things,<br>kept in working order.</h1>
        <p class="lede">A curated directory of public tools and intentionally listed restricted services. Status is prepared by a five-minute checker; this page does not poll in the background.</p>
        <p class="freshness">Snapshot generated <time datetime="${escapeHtml(snapshot.generatedAt)}">${formatTimestamp(snapshot.generatedAt)}</time></p>
      </section>
      <div class="catalog" aria-label="Tool directory">
        ${groups.length === 0 ? emptyState() : groups.map((group) => renderGroup(group, entries, snapshot)).join("")}
      </div>
    </main>
    <footer class="site-footer">
      <div class="wrap"><p>Tools Platform <span aria-hidden="true">·</span> On-demand directory, scheduled checks.</p></div>
    </footer>`;

  return pageShell({
    title: "Tools — Mauroner",
    description: "A curated directory and status overview for Mauroner tools.",
    body
  });
}

function renderGroup(
  group: PublicGroup,
  entries: PublicCatalogEntry[],
  snapshot: PublicSnapshotDocument
): string {
  const groupedEntries = entries.filter((entry) => entry.groupId === group.id);
  if (groupedEntries.length === 0) {
    return "";
  }
  return `<section class="catalog-group" aria-labelledby="group-${escapeHtml(group.id)}">
          <header class="group-header">
            <p class="group-index" aria-hidden="true">${String(group.order + 1).padStart(2, "0")}</p>
            <div>
              <h2 id="group-${escapeHtml(group.id)}">${escapeHtml(group.name)}</h2>
              ${group.description ? `<p>${escapeHtml(group.description)}</p>` : ""}
            </div>
          </header>
          <ul class="tool-grid" role="list">
            ${groupedEntries.map((entry) => renderEntry(entry, snapshot)).join("")}
          </ul>
        </section>`;
}

function renderEntry(
  entry: PublicCatalogEntry,
  snapshot: PublicSnapshotDocument
): string {
  const status = snapshot.statuses[entry.id];
  const links = entry.links
    .map((link) => {
      const url = safeHttpUrl(link.url);
      if (!url) {
        return "";
      }
      const restricted =
        link.access === "restricted"
          ? '<span class="access-badge">Restricted</span>'
          : "";
      const accessibleSuffix =
        link.access === "restricted" ? " (restricted access)" : "";
      return `<a class="tool-link" href="${escapeHtml(url)}" rel="noreferrer">
                <span>${escapeHtml(link.label)}${accessibleSuffix ? `<span class="visually-hidden">${accessibleSuffix}</span>` : ""}</span>
                ${restricted}
                <span aria-hidden="true">↗</span>
              </a>`;
    })
    .filter(Boolean)
    .join("");

  return `<li class="tool-card">
              <div class="tool-card__top">
                <h3>${escapeHtml(entry.name)}</h3>
                ${statusBadge(status)}
              </div>
              <p>${escapeHtml(entry.description)}</p>
              <p class="status-detail">${statusDetails(status)}</p>
              ${links ? `<div class="tool-links" aria-label="${escapeHtml(entry.name)} links">${links}</div>` : '<p class="no-link">No public link</p>'}
            </li>`;
}

function emptyState(): string {
  return `<section class="empty-state" aria-labelledby="empty-title">
          <p class="eyebrow">Directory</p>
          <h2 id="empty-title">Nothing published yet</h2>
          <p>The catalog is being curated. Check back later.</p>
        </section>`;
}

import { createServerFn } from "@tanstack/react-start";
import type { PrivateSnapshotDocument } from "@tools-platform/domain";
import type { MarkdownAdminSnapshot } from "@tools-platform/web";
import { requirePlatformSession } from "./auth-middleware.js";
import { internalPlatformRequest, readPlatformJson } from "./server-data.js";

const DAY_MS = 86_400_000;

/** Work waiting in each tool. A part is left out when its source cannot be read, so one slow tool does not hide the others. */
export type AttentionSummary = Readonly<{
  moneyReview?: number;
  feedbackUnread?: number;
  documentsExpiring?: ReadonlyArray<Readonly<{ filename: string; expiresAt: number }>>;
  servicesDown?: ReadonlyArray<Readonly<{ name: string; since: string | null }>>;
}>;

export const getAttentionSummary = createServerFn({ method: "GET" })
  .middleware([requirePlatformSession])
  .handler(async (): Promise<AttentionSummary> => {
    const { context } = internalPlatformRequest("/api/ops/snapshot");
    const { runtime } = context;
    const [money, forms, documents, snapshot] = await Promise.allSettled([
      runtime.moneyImports.readReviewCounts(),
      runtime.feedback.listForms(),
      readPlatformJson<MarkdownAdminSnapshot>(runtime.services.manage.handle, "/api/ops/documents"),
      readPlatformJson<PrivateSnapshotDocument>(runtime.services.manage.handle, "/api/ops/snapshot")
    ]);
    const now = Date.now();
    return {
      ...(money.status === "fulfilled" ? { moneyReview: money.value.uncategorized + money.value.transfers } : {}),
      ...(forms.status === "fulfilled" ? { feedbackUnread: forms.value.reduce((sum, form) => sum + form.unreadCount, 0) } : {}),
      ...(documents.status === "fulfilled" ? { documentsExpiring: expiringDocuments(documents.value, now) } : {}),
      ...(snapshot.status === "fulfilled" ? { servicesDown: servicesDown(snapshot.value) } : {})
    };
  });

export function expiringDocuments(snapshot: MarkdownAdminSnapshot, now: number) {
  return snapshot.documents
    .filter((document) => document.expiresAt - now <= DAY_MS)
    .map(({ filename, expiresAt }) => ({ filename, expiresAt }))
    .toSorted((left, right) => left.expiresAt - right.expiresAt);
}

export function servicesDown(snapshot: PrivateSnapshotDocument) {
  return snapshot.catalog.entries
    .filter((entry) => entry.lifecycle === "active" && entry.monitor?.enabled && snapshot.state.monitors[entry.id]?.status === "down")
    .map((entry) => {
      const incidentId = snapshot.state.monitors[entry.id]?.openIncidentId;
      return { name: entry.name, since: snapshot.state.incidents.find(({ id }) => id === incidentId)?.startedAt ?? null };
    });
}

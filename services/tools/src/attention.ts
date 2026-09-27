import { createServerFn } from "@tanstack/react-start";
import type { PrivateSnapshotDocument } from "@tools-platform/domain";
import type { MarkdownAdminSnapshot } from "@tools-platform/web";
import { requirePlatformSession } from "./auth-middleware.js";
import { internalPlatformRequest, readPlatformJson, readPlatformResponse } from "./server-data.js";
import type { FeedbackForm } from "../feedback/domain.js";
import type { UploadInventorySummary } from "./protected-data.js";

const DAY_MS = 86_400_000;

/** Work waiting in each tool. A part is left out when its source cannot be read, so one slow tool does not hide the others. */
export type AttentionSummary = Readonly<{
  moneyReview?: number;
  feedbackUnread?: number;
  documentsExpiring?: ReadonlyArray<Readonly<{ filename: string; expiresAt: number }>>;
  servicesDown?: ReadonlyArray<Readonly<{ name: string; since: string | null }>>;
}>;

export type DashboardData = Readonly<{
  publicOrigin: string;
  snapshot: PrivateSnapshotDocument;
  attention: AttentionSummary;
  facts: Readonly<{ artifacts?: number; activeForms?: number; documents?: number; documentsTruncated?: boolean; nextDocumentExpiry?: number }>;
}>;

type PlatformContext = ReturnType<typeof internalPlatformRequest>["context"];

export const getAttentionSummary = createServerFn({ method: "GET" })
  .middleware([requirePlatformSession])
  .handler(async (): Promise<AttentionSummary> => {
    const { context } = internalPlatformRequest("/api/ops/snapshot");
    const [money, forms, documents, snapshot] = await Promise.allSettled([
      context.runtime.moneyImports.readReviewCounts(),
      context.runtime.feedback.listForms(),
      readDocuments(context),
      readSnapshot(context)
    ]);
    return attentionFrom({ money: settled(money), forms: settled(forms), documents: settled(documents), snapshot: settled(snapshot) }, Date.now());
  });

export const getDashboardData = createServerFn({ method: "GET" })
  .middleware([requirePlatformSession])
  .handler(async (): Promise<DashboardData> => {
    const { context } = internalPlatformRequest("/api/ops/snapshot");
    const [snapshot, money, forms, documents, uploads] = await Promise.all([
      readSnapshot(context),
      context.runtime.moneyImports.readReviewCounts().catch(() => undefined),
      context.runtime.feedback.listForms().catch(() => undefined),
      readDocuments(context).catch(() => undefined),
      readUploadSummary(context).catch(() => undefined)
    ]);
    const now = Date.now();
    const active = documents?.documents.filter((document) => document.expiresAt > now);
    return {
      publicOrigin: context.runtime.publicOrigin,
      snapshot,
      attention: attentionFrom({ money, forms, documents, snapshot }, now),
      facts: {
        ...(uploads ? { artifacts: uploads.total } : {}),
        ...(forms ? { activeForms: forms.filter((form) => form.status === "active").length } : {}),
        ...(active ? { documents: active.length, documentsTruncated: Boolean(documents?.nextCursor), ...(!documents?.nextCursor && active.length ? { nextDocumentExpiry: Math.min(...active.map((document) => document.expiresAt)) } : {}) } : {})
      }
    };
  });

export function attentionFrom(
  sources: { money?: { uncategorized: number; transfers: number }; forms?: readonly FeedbackForm[]; documents?: MarkdownAdminSnapshot; snapshot?: PrivateSnapshotDocument },
  now: number
): AttentionSummary {
  return {
    ...(sources.money ? { moneyReview: sources.money.uncategorized + sources.money.transfers } : {}),
    ...(sources.forms ? { feedbackUnread: sources.forms.reduce((sum, form) => sum + form.unreadCount, 0) } : {}),
    ...(sources.documents ? { documentsExpiring: expiringDocuments(sources.documents, now) } : {}),
    ...(sources.snapshot ? { servicesDown: servicesDown(sources.snapshot) } : {})
  };
}

export function expiringDocuments(snapshot: MarkdownAdminSnapshot, now: number) {
  return snapshot.documents
    .filter((document) => document.expiresAt > now && document.expiresAt - now <= DAY_MS)
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

function settled<T>(result: PromiseSettledResult<T>) {
  return result.status === "fulfilled" ? result.value : undefined;
}

function readSnapshot(context: PlatformContext) {
  return readPlatformJson<PrivateSnapshotDocument>(context.runtime.services.manage.handle, "/api/ops/snapshot");
}

function readDocuments(context: PlatformContext) {
  return readPlatformJson<MarkdownAdminSnapshot>(context.runtime.services.manage.handle, "/api/ops/documents");
}

async function readUploadSummary(context: PlatformContext) {
  const response = await readPlatformResponse(context.runtime.services.publisher.handle, "/api/external-uploads?limit=1&sort=newest&includeSummary=true");
  if (!response.ok) throw new Error(`Artifact summary request failed: ${response.status}`);
  const body = await response.json() as { summary?: UploadInventorySummary };
  if (!body.summary) throw new Error("Artifact summary is missing.");
  return body.summary;
}

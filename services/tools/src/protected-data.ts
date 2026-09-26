import { createServerFn } from "@tanstack/react-start";
import type {
  PrivateSnapshotDocument
} from "@tools-platform/domain";
import type { MarkdownAdminSnapshot } from "@tools-platform/web";
import { requirePlatformSession } from "./auth-middleware.js";
import { internalPlatformRequest, readPlatformJson, readPlatformResponse } from "./server-data.js";
import { MONEY_LEDGER_SCOPES, type MoneyLedgerViewScope, type MoneyLedgerSnapshot } from "../money/money-repository.js";
import type { MoneyMarketSnapshot } from "../money/money-market-data-service.js";
import { checkInBaseline, moneyCheckIn, type MoneyCheckIn } from "../money/money-checkin-domain.js";

export type UploadSummary = {
  id: string;
  kind: "html" | "file";
  filename: string;
  contentType: string;
  url: string;
  bytes: number;
  updatedAt: string;
  expiresAt?: string;
  project?: string;
};

export type UploadPageData = {
  uploads: UploadSummary[];
  nextCursor?: string;
  summary?: UploadInventorySummary;
};

export type UploadInventorySummary = {
  total: number;
  permanent: number;
  temporary: number;
  expiringSoon: number;
  projects: Array<{ project: string | null; count: number }>;
};

export type ManagePageData = UploadPageData;

export type PrivateStatusPageData = {
  actor: string;
  publicOrigin: string;
  snapshot: PrivateSnapshotDocument;
};

export type DocumentsPageData = MarkdownAdminSnapshot & {
  actor: string;
  publicOrigin: string;
};

export type MoneyTrackerPageData = MoneyLedgerSnapshot & { actor: string; marketData: MoneyMarketSnapshot; checkIn?: MoneyCheckIn };

export const getMoneyTrackerPageData = createServerFn({ method: "GET" })
  .middleware([requirePlatformSession])
  .validator((input: { view: MoneyLedgerViewScope; since?: string }) => {
    if (!MONEY_LEDGER_SCOPES.includes(input.view)) throw new Error("Invalid Money view");
    if (input.since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.since)) throw new Error("Invalid check-in date");
    return input;
  })
  .handler(async ({ data }): Promise<MoneyTrackerPageData> => {
    const { context } = internalPlatformRequest("/money");
    const { moneyImports, moneyMarketData } = context.runtime;
    const needsMarketData = data.view === "overview" || data.view === "investments" || data.view === "accounts" || data.view === "insights" || data.view === "predictions" || data.view === "data";
    const needsCheckIn = data.view === "overview" || data.view === "investments";
    const days = needsCheckIn ? await moneyImports.readCheckInDays() : [];
    const baseline = checkInBaseline(days, data.since);
    const [ledger, { movesSince, ...marketData }, cash] = await Promise.all([
      moneyImports.readLedgerSnapshot(data.view),
      needsMarketData ? moneyMarketData.snapshot({ since: baseline }) : Promise.resolve(emptyMarketSnapshot()),
      baseline ? moneyImports.readCashMovesSince(baseline) : undefined
    ]);
    return {
      actor: context.principal?.email ?? "Authenticated user",
      ...ledger,
      marketData,
      ...(movesSince && cash ? { checkIn: moneyCheckIn({ days, positions: movesSince, cash }) } : {})
    };
  });

function emptyMarketSnapshot(): MoneyMarketSnapshot {
  return {
    asOf: "1970-01-01T00:00:00.000Z",
    positions: [],
    history: [],
    totals: {
      costBasisMinor: 0,
      knownMarketValueMinor: 0,
      knownUnrealizedGainMinor: 0,
      complete: true
    }
  };
}

export const getPrivateStatusPageData = createServerFn({ method: "GET" })
  .middleware([requirePlatformSession])
  .handler(async (): Promise<PrivateStatusPageData> => {
    const { context } = internalPlatformRequest("/api/ops/snapshot");
    return {
      actor: context.principal?.email ?? "Authenticated user",
      publicOrigin: context.runtime.publicOrigin,
      snapshot: await readPlatformJson<PrivateSnapshotDocument>(context.runtime.services.manage.handle, "/api/ops/snapshot")
    };
  });

export const getManagePageData = createServerFn({ method: "GET" })
  .middleware([requirePlatformSession])
  .handler(async (): Promise<ManagePageData> => {
    const pathname = "/api/external-uploads?limit=100&sort=newest&includeSummary=true";
    const { context } = internalPlatformRequest(pathname);
    const response = await readPlatformResponse(
      context.runtime.services.publisher.handle,
      pathname
    );
    if (!response.ok) throw new Error(`Artifact inventory request failed: ${response.status}`);
    return response.json() as Promise<ManagePageData>;
  });

export const getDocumentsPageData = createServerFn({ method: "GET" })
  .middleware([requirePlatformSession])
  .handler(async (): Promise<DocumentsPageData> => {
    const { context } = internalPlatformRequest("/api/ops/documents");
    const result = await readPlatformJson<MarkdownAdminSnapshot & { publicOrigin: string }>(
      context.runtime.services.manage.handle,
      "/api/ops/documents"
    );
    return {
      ...result,
      actor: context.principal?.email ?? "Authenticated user"
    };
  });

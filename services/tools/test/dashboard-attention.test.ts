import { describe, expect, it, vi } from "vitest";
import type { PrivateSnapshotDocument } from "#domain";

const sources = vi.hoisted(() => ({
  money: vi.fn(async () => ({ uncategorized: 0, transfers: 0 })),
  forms: vi.fn(async () => []),
  documents: vi.fn(async () => ({ generatedAt: 0, documents: [], truncated: false })),
  json: vi.fn(),
  response: vi.fn()
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({ middleware: () => ({ handler: (handler: (input: unknown) => Promise<unknown>) =>
    () => handler({ context: { principal: { role: "admin", subject: "admin-subject", email: "admin@example.test" } } }) }) })
}));
vi.mock("../src/auth-middleware.js", () => ({ requirePlatformSession: {} }));
vi.mock("../src/server-data.js", () => ({
  internalPlatformRequest: () => ({ context: { runtime: {
    publicOrigin: "https://tools.example.test",
    moneyImports: { readReviewCounts: sources.money },
    feedback: { owner: (subject: string) => subject === "admin-subject" ? { listForms: sources.forms } : undefined },
    documentShare: { owner: (subject: string) => subject === "admin-subject" ? { list: sources.documents } : undefined },
    services: { manage: { handle: vi.fn() }, publisher: { handle: vi.fn() } }
  } } }),
  readPlatformJson: sources.json,
  readPlatformResponse: sources.response
}));
import { getDashboardData } from "../src/attention.js";

const snapshot: PrivateSnapshotDocument = {
  schemaVersion: 1, generatedAt: "2026-10-02T12:00:00.000Z", catalogRevision: "synthetic",
  catalog: { schemaVersion: 1, revision: "synthetic", updatedAt: "2026-10-02T12:00:00.000Z", groups: [], entries: [] },
  state: { schemaVersion: 2, revision: "synthetic", updatedAt: "2026-10-02T12:00:00.000Z", lastRunId: null, monitors: {}, incidents: [], notifications: [], historyPending: [] }
};

describe("Dashboard file attention", () => {
  it("keeps even expiring files out of attention while retaining the inventory count", async () => {
    sources.json.mockImplementation(async (_handler: unknown, path: string) => path === "/api/ops/snapshot" ? snapshot : undefined);
    sources.response.mockResolvedValue(Response.json({ summary: {
      total: 142, permanent: 92, temporary: 50, expiringSoon: 50, projects: []
    } }));

    const data = await getDashboardData();

    expect(data.facts.artifacts).toBe(142);
    expect(data.facts.documents).toBe(0);
    expect(data.attention).toEqual({ moneyReview: 0, feedbackUnread: 0, documentsExpiring: [], servicesDown: [] });
    expect(sources.response).toHaveBeenCalledWith(expect.any(Function), "/api/external-uploads?limit=1&sort=newest&includeSummary=true");
  });
});

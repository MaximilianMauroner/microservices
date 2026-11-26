import { addDays, type WeightChange } from "@tools-platform/service/bodyshop-contract";
import { healthAdapter } from "./adapter";
import { HEALTH_FEATURES, type Availability, type HealthFeature, type NutritionRecord } from "./contract";
import { readHealthCheckIns } from "./check-ins";
import { nutritionId, nutritionRecord, viennaTime } from "./nutrition";
import { vault } from "../storage/vault";
import { bodyshopApi } from "../sync/api";

type WeightPage = Awaited<ReturnType<typeof healthAdapter.weightChanges>>;
type Weight = { since: string; token?: string; bootstrap?: WeightPage };
type Operation = { record: NutritionRecord } | { delete: string };
type Nutrition = {
  baseline: string;
  after: string;
  namespace: string;
  pending?: { operations: Operation[]; cursor: string };
};
type Preferences = { weight?: Weight; nutrition?: Nutrition; steps?: true; sleep?: true; extendedHistory?: true; backfill?: Partial<Record<"steps" | "sleep", { day: string; extended: boolean }>>; lastSync?: string };
type Status = "idle" | "syncing" | "failed" | "permission-required" | "server-update-required";
type View = { availability: Availability; status: Status; preferences: Preferences; permissions: HealthFeature[] };
type Run = { key: string; preferences: Preferences; afterImport: () => void; abort: AbortController; suspended: Set<HealthFeature> };

let session: Run | undefined;
let epoch = 0;
let active = Promise.resolve();
let scheduled: Run | undefined;
const listeners = new Set<() => void>();
const initial: View = { availability: "unavailable", status: "idle", preferences: {}, permissions: [] };
let view = initial;

function publish(next: Partial<View>) {
  view = { ...view, ...next };
  listeners.forEach((listener) => listener());
}

function current(run: Run, feature?: HealthFeature) {
  if (session !== run) throw new Error("Health Connect session changed.");
  if (feature && run.suspended.has(feature)) throw new Error("Health Connect sync stopped.");
}

async function save(run: Run, preferences: Preferences) {
  current(run);
  await vault.saveSetting(run.key, JSON.stringify(preferences));
  current(run);
  run.preferences = preferences;
  publish({ preferences });
}

async function refreshPermissions(run: Run) {
  const availability = await healthAdapter.availability();
  current(run);
  const permissions = availability === "available" ? await healthAdapter.permissions() : [];
  current(run);
  publish({ availability, permissions });
  return permissions;
}

async function sendWeights(run: Run, weights: readonly WeightChange[]) {
  for (let i = 0; i < weights.length; i += 100) {
    current(run, "weight");
    await bodyshopApi.importWeight(weights.slice(i, i + 100), run.abort.signal);
  }
}

async function importWeights(run: Run, state: Weight) {
  current(run, "weight");
  let page = state.bootstrap ?? await healthAdapter.weightChanges(state.token);
  current(run, "weight");
  let scannedHistory = !state.token || Boolean(state.bootstrap) || page.expired;
  if (scannedHistory) {
    if (page.expired) page = await healthAdapter.weightChanges();
    if (page.expired || !page.token) throw new Error("A new weight changes token is unavailable.");
    if (!state.bootstrap) {
      // Save the unprocessed page before importing history. If the app stops
      // during the scan, the next run still sees deletions that happened during it.
      await save(run, { ...run.preferences, weight: { since: state.since, bootstrap: page } });
    }
    let cursor: string | undefined;
    do {
      current(run, "weight");
      const batch = await healthAdapter.weights(state.since, cursor);
      await sendWeights(run, batch.changes);
      cursor = batch.next;
    } while (cursor);
  }
  for (;;) {
    if (page.expired || !page.token) throw new Error("Weight changes token expired.");
    await sendWeights(run, page.changes);
    await save(run, { ...run.preferences, weight: { since: state.since, token: page.token } });
    if (!page.more && !scannedHistory) return;
    scannedHistory = false;
    current(run, "weight");
    page = await healthAdapter.weightChanges(page.token);
  }
}

async function exportNutrition(run: Run, state: Nutrition) {
  for (;;) {
    current(run, "nutrition");
    if (!state.pending) {
      const page = await bodyshopApi.healthFeed({ baseline: state.baseline, after: state.after }, run.abort.signal);
      if (page.kind !== "changes") throw new Error("Invalid nutrition feed.");
      const last = page.changes.at(-1);
      if (!last) return;
      const operations = page.changes.map((change): Operation => {
        const record = nutritionRecord(change, state.namespace, page.dayStartHour);
        return record ? { record } : { delete: nutritionId(state.namespace, change.id) };
      });
      state = { ...state, pending: { operations, cursor: last.cursor } };
      await save(run, { ...run.preferences, nutrition: state });
    }
    const { operations, cursor } = state.pending!;
    // Each operation is replayable, but checkpoint the remainder to avoid replaying
    // a create before its deletion if a later operation is interrupted.
    for (let i = 0; i < operations.length; i += 1) {
      current(run, "nutrition");
      const operation = operations[i]!;
      if ("record" in operation) await healthAdapter.upsertNutrition(operation.record);
      else await healthAdapter.deleteNutrition(operation.delete);
      await save(run, { ...run.preferences, nutrition: { ...state, pending: { cursor, operations: operations.slice(i + 1) } } });
    }
    state = { baseline: state.baseline, namespace: state.namespace, after: cursor };
    await save(run, { ...run.preferences, nutrition: state });
  }
}

function serialize(run: Run, work: () => Promise<void>) {
  const next = active.then(async () => {
    if (session !== run) return;
    try { await work(); } catch {
      if (session === run) {
        const permissions = await refreshPermissions(run).catch(() => null);
        if (session !== run) return;
        const missing = permissions && HEALTH_FEATURES.some((feature) => run.preferences[feature] && !permissions.includes(feature));
        publish({ status: missing ? "permission-required" : "failed" });
      }
    }
  });
  active = next;
  return next;
}

export const healthSync = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  snapshot: () => view,
  async connectSession(afterImport: () => void) {
    const mine = ++epoch;
    const account = await vault.setting("account").catch(() => null);
    if (mine !== epoch || !account) return;
    const key = `health-connect:${account}`;
    const raw = await vault.setting(key).catch(() => null);
    if (mine !== epoch) return;
    let preferences: Preferences = {};
    try { if (raw) preferences = JSON.parse(raw) as Preferences; } catch { /* Require consent again for unreadable settings. */ }
    session = { key, preferences, afterImport, abort: new AbortController(), suspended: new Set() };
    publish({ preferences });
    void healthSync.sync();
  },
  clearSession() {
    epoch += 1;
    session?.abort.abort();
    session = undefined;
    publish(initial);
  },
  sync() {
    const run = session;
    if (!run || scheduled === run) return;
    scheduled = run;
    return serialize(run, async () => {
      scheduled = undefined;
      const permissions = await refreshPermissions(run);
      const { weight, nutrition } = run.preferences;
      if (!HEALTH_FEATURES.some((feature) => run.preferences[feature])) return publish({ status: "idle" });
      publish({ status: "syncing" });
      let failed = false;
      let succeeded = false;
      if (weight && permissions.includes("weight") && !run.suspended.has("weight")) {
        try {
          await importWeights(run, weight);
          succeeded = true;
          current(run);
          run.afterImport();
        } catch { failed = !run.suspended.has("weight"); }
      }
      if (nutrition && permissions.includes("nutrition") && !run.suspended.has("nutrition")) {
        try { await exportNutrition(run, nutrition); succeeded = true; } catch { failed ||= !run.suspended.has("nutrition"); }
      }
      for (const feature of ["steps", "sleep"] as const) {
        if (!run.preferences[feature] || !permissions.includes(feature) || run.suspended.has(feature)) continue;
        try {
          const now = Date.now();
          const day = viennaTime(now).wall.slice(0, 10);
          const extended = Boolean(run.preferences.extendedHistory && await healthAdapter.historyAccess?.());
          const previous = run.preferences.backfill?.[feature];
          const length = previous && previous.day >= addDays(day, -6) && previous.extended === extended ? 7 : extended ? 90 : 29;
          const rows = await readHealthCheckIns(feature, healthAdapter, now, () => current(run, feature), length);
          // Keep requests compatible with servers that accept seven daily summaries at a time.
          for (let offset = 0; offset < Math.max(rows.length, 1); offset += 7) {
            current(run, feature);
            await bodyshopApi.importHealthCheckIns(rows.slice(offset, offset + 7), run.abort.signal);
          }
          current(run, feature);
          if (length > 7) await save(run, {
            ...run.preferences, backfill: { ...run.preferences.backfill, [feature]: { day, extended } },
          });
          run.afterImport();
          succeeded = true;
        } catch { failed ||= !run.suspended.has(feature); }
      }
      current(run);
      if (succeeded && !failed) await save(run, { ...run.preferences, lastSync: new Date().toISOString() });
      const missing = HEALTH_FEATURES.some((feature) => run.preferences[feature] && !permissions.includes(feature));
      if (failed) await refreshPermissions(run).catch(() => null);
      current(run);
      const revoked = HEALTH_FEATURES.some((feature) => run.preferences[feature] && !view.permissions.includes(feature));
      publish({ status: missing || revoked ? "permission-required" : failed ? "failed" : "idle" });
    });
  },
  setEnabled(feature: HealthFeature, enabled: boolean) {
    const run = session;
    if (!run) return;
    if (!enabled) run.suspended.add(feature);
    return serialize(run, async () => {
      if (!enabled) {
        await save(run, { ...run.preferences, [feature]: undefined });
        publish({ status: "idle" });
        return;
      }
      const permissions = await refreshPermissions(run);
      if (view.availability !== "available") return;
      if ((feature === "steps" || feature === "sleep") && !run.preferences[feature]) {
        const server = await bodyshopApi.healthFeed(undefined, run.abort.signal);
        current(run);
        if (server.kind !== "baseline" || !server.checkIns) {
          publish({ status: "server-update-required" });
          return;
        }
      }
      if (!permissions.includes(feature) && !await healthAdapter.request(feature)) {
        await refreshPermissions(run);
        publish({ status: "permission-required" });
        return;
      }
      current(run);
      if (!run.preferences[feature]) {
        if (feature === "weight") {
          const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
          await save(run, { ...run.preferences, weight: { since } });
        } else if (feature === "nutrition") {
          const baseline = await bodyshopApi.healthFeed(undefined, run.abort.signal);
          if (baseline.kind !== "baseline") throw new Error("Invalid nutrition baseline.");
          await save(run, {
            ...run.preferences,
            nutrition: { baseline: baseline.cursor, after: baseline.cursor, namespace: baseline.namespace },
          });
        } else await save(run, { ...run.preferences, [feature]: true });
      }
      run.suspended.delete(feature);
      void healthSync.sync();
    });
  },
  setExtendedHistory(enabled: boolean) {
    const run = session;
    if (!run) return;
    return serialize(run, async () => {
      if (enabled) {
        try {
          if (!await healthAdapter.historyAccess?.(true)) {
            publish({ status: "permission-required" });
            return;
          }
        } catch {
          publish({ status: "failed" });
          return;
        }
      }
      await save(run, { ...run.preferences, extendedHistory: enabled ? true : undefined });
      void healthSync.sync();
    });
  },
  disconnect() {
    const run = session;
    if (!run) return;
    for (const feature of HEALTH_FEATURES) run.suspended.add(feature);
    return serialize(run, async () => {
      await save(run, {});
      publish({ status: "idle" });
    });
  },
  openSettings: () => healthAdapter.openSettings(),
};

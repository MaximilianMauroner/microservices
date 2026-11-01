import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { postgresScheduledTaskLeaseRepository } from "../src/scheduled-task-leases.js";
import { runDueMaintenance } from "../src/maintenance.js";

const url = process.env.MAINTENANCE_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!["postgres:", "postgresql:"].includes(target.protocol) || target.hostname !== "127.0.0.1" || target.search
    || !target.pathname.startsWith("/tools_maintenance_fixture")) {
    throw new Error("Maintenance fixture must be local without connection overrides");
  }
}
const sql = url ? postgres(url, { max: 2 }) : undefined;
beforeAll(async () => {
  if (!sql) return;
  await sql`create schema if not exists tools`;
  await sql`create table if not exists tools.scheduled_task_runs (
    task_id text not null, slot timestamptz not null, owner_id text not null,
    lease_until timestamptz not null, completed_at timestamptz, result jsonb,
    primary key (task_id, slot))`;
});
afterAll(async () => { await sql?.end(); });

describe.skipIf(!sql)("durable maintenance leases", () => {
  it("fences concurrent, interrupted and stale workers; allows failed slots to retry", async () => {
    if (!sql) throw new Error("Fixture unavailable");
    const repository = postgresScheduledTaskLeaseRepository(sql);
    const input = { taskId: `market-${crypto.randomUUID()}`, slot: new Date("2026-10-13T03:15:00Z"), leaseDurationMs: 60_000 };
    const claims = await Promise.all([
      repository.acquire({ ...input, ownerId: "a" }), repository.acquire({ ...input, ownerId: "b" })
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const ownerId = claims[0] ? "a" : "b";
    expect(await repository.acquire({ ...input, slot: new Date("2026-10-14T03:15:00Z"), ownerId: "next" })).toBe(false);
    await sql`update tools.scheduled_task_runs set lease_until=now()-interval '1 second' where task_id=${input.taskId}`;
    expect(await repository.acquire({ ...input, ownerId: "restart" })).toBe(true);
    await expect(repository.complete({ ...input, ownerId, result: { outcome: "complete" } }))
      .rejects.toThrow("Maintenance lease is no longer owned");
    const [fenced] = await sql`select completed_at from tools.scheduled_task_runs where task_id=${input.taskId}`;
    expect(fenced?.completed_at).toBeNull();
    await repository.complete({ ...input, ownerId: "restart", result: { outcome: "failed" } });
    expect(await repository.acquire({ ...input, ownerId: "retry" })).toBe(true);
    await repository.complete({ ...input, ownerId: "retry", result: { outcome: "complete" } });
    expect(await repository.acquire({ ...input, ownerId: "duplicate" })).toBe(false);
    // New connections and a fresh repository still see the durable completed slot.
    const restartedSql = postgres(url!, { max: 1 });
    const restarted = postgresScheduledTaskLeaseRepository(restartedSql);
    try {
      expect(await restarted.acquire({ ...input, ownerId: "new-process" })).toBe(false);
      expect(await restarted.acquire({ ...input, slot: new Date("2026-10-14T03:15:00Z"), ownerId: "next" })).toBe(true);
    } finally { await restarted.close(); }
  });

  it("recovers lost claim and completion acknowledgements without running the task twice", async () => {
    if (!sql) throw new Error("Fixture unavailable");
    const durable = postgresScheduledTaskLeaseRepository(sql);
    const taskId = `lost-ack-${crypto.randomUUID()}`;
    let lostClaim = true;
    let lostCompletion = true;
    const repository = {
      ...durable,
      acquire: async (input: Parameters<typeof durable.acquire>[0]) => {
        const acquired = await durable.acquire(input);
        if (lostClaim) { lostClaim = false; throw new Error("claim response lost after commit"); }
        return acquired;
      },
      complete: async (input: Parameters<typeof durable.complete>[0]) => {
        await durable.complete(input);
        if (lostCompletion) { lostCompletion = false; throw new Error("completion response lost after commit"); }
      }
    };
    const run = vi.fn().mockResolvedValue(undefined);
    const options = { repository, ownerId: "original", signal: new AbortController().signal,
      tasks: [{ id: taskId, intervalMs: 3_600_000, run }], log: vi.fn() };
    await runDueMaintenance(options);
    await runDueMaintenance({ ...options, repository: durable, ownerId: "restarted" });
    expect(run).toHaveBeenCalledOnce();
    const rows = await sql`select completed_at, result from tools.scheduled_task_runs where task_id=${taskId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.completed_at).not.toBeNull();
    expect(rows[0]?.result).toEqual({ outcome: "complete" });
  });

  it("rejects expired owners even when a newer slot has a different owner", async () => {
    if (!sql) throw new Error("Fixture unavailable");
    const repository = postgresScheduledTaskLeaseRepository(sql);
    const input = { taskId: `expired-${crypto.randomUUID()}`, slot: new Date("2026-10-13T03:15:00Z"),
      ownerId: "expired", leaseDurationMs: 60_000 };
    expect(await repository.acquire(input)).toBe(true);
    await sql`update tools.scheduled_task_runs set lease_until=now()-interval '1 second' where task_id=${input.taskId}`;
    expect(await repository.acquire({ ...input, slot: new Date("2026-10-14T03:15:00Z"), ownerId: "current" })).toBe(true);
    await expect(repository.complete({ ...input, result: { outcome: "complete" } }))
      .rejects.toThrow("Maintenance lease is no longer owned");
    const [row] = await sql`select completed_at from tools.scheduled_task_runs where task_id=${input.taskId} and slot=${input.slot}`;
    expect(row?.completed_at).toBeNull();
  });
});

import type { ScheduledTaskLeaseRepository } from "./scheduled-task-leases.js";
import { retryTransientOperation } from "./response-retry.js";

export const MAINTENANCE_DEADLINE_MS = 10 * 60_000;
export const MAINTENANCE_LEASE_MS = 15 * 60_000;

export type MaintenanceTask = Readonly<{
  id: string;
  intervalMs: number;
  phaseOffsetMs?: number;
  run: () => Promise<void>;
}>;

/** Slot rows are durable due times. Missed slots coalesce because both tasks reconcile current state. */
export async function runDueMaintenance(options: {
  repository: ScheduledTaskLeaseRepository;
  ownerId: string;
  tasks: readonly MaintenanceTask[];
  signal: AbortSignal;
  now?: () => number;
  log: (event: string, fields: Record<string, string>) => void;
}) {
  const now = options.now ?? Date.now;
  let failed = false;
  for (const task of options.tasks) {
    options.signal.throwIfAborted();
    const phase = task.phaseOffsetMs ?? 0;
    const slot = new Date(Math.floor((now() - phase) / task.intervalMs) * task.intervalMs + phase);
    const identity = { taskId: task.id, slot, ownerId: options.ownerId };
    const acquired = await retryTransientOperation(() => options.repository.acquire({
      ...identity,
      leaseDurationMs: MAINTENANCE_LEASE_MS
    }));
    options.signal.throwIfAborted();
    if (!acquired) continue;
    try {
      await task.run();
      options.signal.throwIfAborted();
      await options.repository.complete({ ...identity, result: { outcome: "complete" } });
      options.log("maintenance.task_complete", { task: task.id, slot: slot.toISOString() });
    } catch (error) {
      failed = true;
      // An interrupted process leaves its lease to expire. A known failure can retry this slot.
      if (options.signal.aborted) throw error;
      const errorType = error instanceof Error ? error.name : "UnknownError";
      await options.repository.complete({ ...identity, result: { outcome: "failed", errorType } });
      options.log("maintenance.task_failed", { task: task.id, errorType });
    }
  }
  if (failed) throw new Error("Maintenance tasks failed");
}

import postgres, { type Sql } from "postgres";

export type ScheduledTaskResult = Readonly<{
  outcome: "complete" | "failed";
  errorType?: string;
}>;

export interface ScheduledTaskLeaseRepository {
  acquire(input: Readonly<{
    taskId: string;
    slot: Date;
    ownerId: string;
    leaseDurationMs: number;
  }>): Promise<boolean>;
  complete(input: Readonly<{
    taskId: string;
    slot: Date;
    ownerId: string;
    result: ScheduledTaskResult;
  }>): Promise<void>;
  close(): Promise<void>;
}

export function createPostgresScheduledTaskLeaseRepository(
  databaseUrl: string
): ScheduledTaskLeaseRepository {
  return postgresScheduledTaskLeaseRepository(postgres(databaseUrl, { max: 2, idle_timeout: 120 }));
}

export function postgresScheduledTaskLeaseRepository(
  sql: Sql
): ScheduledTaskLeaseRepository {
  return {
    acquire: (input) => sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`scheduled-task:${input.taskId}`}, 0))`;
      const active = await tx<{ active: boolean }[]>`
        select exists(
          select 1 from tools.scheduled_task_runs
          where task_id = ${input.taskId}
            and completed_at is null
            and lease_until > now()
            and slot <> ${input.slot}
        ) active
      `;
      if (active[0]?.active) return false;

      const claimed = await tx<{ task_id: string }[]>`
        insert into tools.scheduled_task_runs
          (task_id, slot, owner_id, lease_until, completed_at, result)
        values (
          ${input.taskId}, ${input.slot}, ${input.ownerId},
          now() + ${input.leaseDurationMs} * interval '1 millisecond', null, null
        )
        on conflict (task_id, slot) do update set
          owner_id = excluded.owner_id,
          lease_until = excluded.lease_until,
          completed_at = null,
          result = null
        where tools.scheduled_task_runs.completed_at is null
          and tools.scheduled_task_runs.lease_until <= now()
        returning task_id
      `;
      return claimed.length === 1;
    }),
    async complete(input) {
      await sql`
        update tools.scheduled_task_runs
        set completed_at = now(), result = ${JSON.stringify(input.result)}::jsonb
        where task_id = ${input.taskId}
          and slot = ${input.slot}
          and owner_id = ${input.ownerId}
          and completed_at is null
      `;
    },
    close: () => sql.end()
  };
}

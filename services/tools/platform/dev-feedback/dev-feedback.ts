import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import type { DevFeedback, DevFeedbackAuthor, DevFeedbackInput, DevFeedbackKind, DevFeedbackState, ReportApp } from "./report.js";

export type DevFeedbackRepository = ReturnType<typeof devFeedbackRepository>;

export function createPostgresDevFeedbackRepository(databaseUrl: string, options: { readOnly?: boolean }) {
  return devFeedbackRepository(postgres(databaseUrl, { max: 2, idle_timeout: 120, connection: options.readOnly ? { default_transaction_read_only: true } : undefined }));
}

type Row = { id: string; app: ReportApp; kind: DevFeedbackKind; page: string; message: string; details: string | null; context: string | null; author_email: string | null; contact_email: string | null; state: DevFeedbackState; created_at: Date };

export function devFeedbackRepository(sql: Sql) {
  return {
    async send(input: DevFeedbackInput, author: DevFeedbackAuthor) {
      await sql`insert into tools.dev_feedback (id, app, author_subject, author_email, contact_email, kind, page, context, message, details, state, created_at)
        values (${randomUUID()}, ${input.app}, ${author?.subject ?? null}, ${author?.email ?? null}, ${input.contactEmail ?? null}, ${input.kind}, ${input.page}, ${input.context ?? null}, ${input.message}, ${input.details ?? null}, 'open', ${new Date()})`;
    },
    async list(): Promise<DevFeedback[]> {
      const rows = await sql<Row[]>`
        select id, app, kind, page, message, details, context, author_email, contact_email, state, created_at from tools.dev_feedback order by created_at desc limit 500`;
      return rows.map((row) => ({
        id: row.id, app: row.app, kind: row.kind, page: row.page, message: row.message, state: row.state, createdAt: row.created_at.toISOString(),
        ...(row.details ? { details: row.details } : {}), ...(row.context ? { context: row.context } : {}), ...(row.author_email ? { authorEmail: row.author_email } : {}), ...(row.contact_email ? { contactEmail: row.contact_email } : {})
      }));
    },
    async countOpen() {
      const [row] = await sql<{ count: number }[]>`select count(*)::int count from tools.dev_feedback where state = 'open'`;
      return row?.count ?? 0;
    },
    /** Returns false when no report has this id. */
    async setState(id: string, state: DevFeedbackState) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
      return (await sql`update tools.dev_feedback set state = ${state} where id = ${id} returning id`).length === 1;
    },
    close: () => sql.end()
  };
}

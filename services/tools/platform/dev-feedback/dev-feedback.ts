import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";

export const DEV_FEEDBACK_KINDS = ["bug", "feature"] as const;
export type DevFeedbackKind = (typeof DEV_FEEDBACK_KINDS)[number];
export type DevFeedbackState = "open" | "done";
export type DevFeedbackInput = Readonly<{ kind: DevFeedbackKind; message: string; page: string }>;

/** A bug report or a feature request about Tools itself, sent to the developer from any page. */
export type DevFeedback = Readonly<{ id: string; kind: DevFeedbackKind; message: string; page: string; authorEmail: string; state: DevFeedbackState; createdAt: string }>;

export function parseDevFeedback(input: { kind: unknown; message: unknown; page: unknown }): DevFeedbackInput {
  if (!DEV_FEEDBACK_KINDS.includes(input.kind as DevFeedbackKind)) throw new Error("Choose a bug report or a feature request.");
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (!message) throw new Error("Write what happened or what you would like.");
  if (message.length > 4000) throw new Error("Keep the message under 4000 characters.");
  const page = typeof input.page === "string" && /^\/(?![/\\])/.test(input.page) ? input.page.slice(0, 500) : "/";
  return { kind: input.kind as DevFeedbackKind, message, page };
}

export type DevFeedbackRepository = ReturnType<typeof devFeedbackRepository>;

export function createPostgresDevFeedbackRepository(databaseUrl: string, options: { readOnly?: boolean }) {
  return devFeedbackRepository(postgres(databaseUrl, { max: 2, idle_timeout: 120, connection: options.readOnly ? { default_transaction_read_only: true } : undefined }));
}

export function devFeedbackRepository(sql: Sql) {
  return {
    async send(input: DevFeedbackInput & { authorSubject: string; authorEmail: string }) {
      await sql`insert into tools.dev_feedback (id, author_subject, author_email, kind, page, message, state, created_at)
        values (${randomUUID()}, ${input.authorSubject}, ${input.authorEmail}, ${input.kind}, ${input.page}, ${input.message}, 'open', ${new Date()})`;
    },
    async list(): Promise<DevFeedback[]> {
      const rows = await sql<{ id: string; kind: DevFeedbackKind; page: string; message: string; author_email: string; state: DevFeedbackState; created_at: Date }[]>`
        select id, kind, page, message, author_email, state, created_at from tools.dev_feedback order by created_at desc limit 500`;
      return rows.map((row) => ({ id: row.id, kind: row.kind, page: row.page, message: row.message, authorEmail: row.author_email, state: row.state, createdAt: row.created_at.toISOString() }));
    },
    /** Returns false when no report has this id. */
    async setState(id: string, state: DevFeedbackState) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
      return (await sql`update tools.dev_feedback set state = ${state} where id = ${id} returning id`).length === 1;
    },
    close: () => sql.end()
  };
}

import { randomBytes, randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import {
  type FeedbackFollowUpState,
  type FeedbackForm,
  type FeedbackLanguage,
  type FeedbackFormStatus,
  type FeedbackQuestion,
  type FeedbackReviewState,
  type FeedbackSubmission
} from "./domain.js";

type FormRow = { id: string; public_token: string; language: FeedbackLanguage; title: string; introduction: string; questions: unknown; status: FeedbackFormStatus; created_at: Date; updated_at: Date; response_count: number; unread_count: number };
type SubmissionRow = { id: string; form_id: string; form_title: string; question_snapshot: unknown; answers: unknown; submitted_at: Date; review_state: FeedbackReviewState; follow_up_state: FeedbackFollowUpState };

export interface FeedbackRepository {
  listForms(): Promise<readonly FeedbackForm[]>;
  createForm(input: { language: FeedbackLanguage }): Promise<FeedbackForm>;
  getForm(id: string): Promise<FeedbackForm | undefined>;
  getPublicForm(token: string): Promise<FeedbackForm | undefined>;
  updateForm(id: string, input: { language: FeedbackLanguage; title: string; introduction: string; questions: readonly FeedbackQuestion[] }): Promise<FeedbackForm | undefined>;
  setFormStatus(id: string, status: FeedbackFormStatus): Promise<FeedbackForm | undefined>;
  rotateToken(id: string): Promise<FeedbackForm | undefined>;
  deleteForm(id: string): Promise<boolean>;
  createSubmission(form: FeedbackForm, answers: Readonly<Record<string, string>>, questionSnapshot?: readonly FeedbackQuestion[]): Promise<string>;
  listSubmissions(formId: string): Promise<readonly FeedbackSubmission[]>;
  getSubmission(id: string): Promise<FeedbackSubmission | undefined>;
  updateSubmission(id: string, input: { reviewState: FeedbackReviewState; followUpState: FeedbackFollowUpState }): Promise<FeedbackSubmission | undefined>;
  deleteSubmission(id: string): Promise<boolean>;
  readiness(): Promise<void>;
  close(): Promise<void>;
}

export function createPostgresFeedbackRepository(databaseUrl: string, options: { readOnly?: boolean } = {}): FeedbackRepository {
  return feedbackRepository(postgres(databaseUrl, { max: 3, connection: options.readOnly ? { default_transaction_read_only: true } : undefined }));
}

export function feedbackRepository(sql: Sql): FeedbackRepository {
  const formSelect = sql`select f.id, f.public_token, f.language, f.title, f.introduction, f.questions, f.status, f.created_at, f.updated_at,
    count(s.id)::int as response_count, count(s.id) filter (where s.review_state = 'unread')::int as unread_count
    from tools.feedback_forms f left join tools.feedback_submissions s on s.form_id = f.id`;
  return {
    async listForms() {
      const rows = await sql<FormRow[]>`${formSelect} group by f.id order by f.updated_at desc`;
      return rows.map(formFromRow);
    },
    async createForm(input) {
      const now = new Date();
      const id = randomUUID();
      await sql`insert into tools.feedback_forms (id, public_token, language, title, introduction, questions, status, created_at, updated_at)
        values (${id}, ${publicToken()}, ${input.language}, '', '', ${sql.json([])}, 'draft', ${now}, ${now})`;
      return required(await this.getForm(id));
    },
    async getForm(id) {
      const [row] = await sql<FormRow[]>`${formSelect} where f.id = ${id} group by f.id`;
      return row ? formFromRow(row) : undefined;
    },
    async getPublicForm(token) {
      const [row] = await sql<FormRow[]>`${formSelect} where f.public_token = ${token} and f.status = 'active' group by f.id`;
      return row ? formFromRow(row) : undefined;
    },
    async updateForm(id, input) {
      await sql`update tools.feedback_forms set language = ${input.language}, title = ${input.title}, introduction = ${input.introduction}, questions = ${sql.json([...input.questions])}, updated_at = ${new Date()} where id = ${id}`;
      return this.getForm(id);
    },
    async setFormStatus(id, status) {
      await sql`update tools.feedback_forms set status = ${status}, updated_at = ${new Date()} where id = ${id}`;
      return this.getForm(id);
    },
    async rotateToken(id) {
      await sql`update tools.feedback_forms set public_token = ${publicToken()}, updated_at = ${new Date()} where id = ${id}`;
      return this.getForm(id);
    },
    async deleteForm(id) {
      const rows = await sql<{ id: string }[]>`delete from tools.feedback_forms where id = ${id} returning id`;
      return rows.length === 1;
    },
    async createSubmission(form, answers, questionSnapshot = form.questions) {
      const id = randomUUID();
      await sql`insert into tools.feedback_submissions (id, form_id, question_snapshot, answers, submitted_at, review_state, follow_up_state)
        values (${id}, ${form.id}, ${sql.json([...questionSnapshot])}, ${sql.json(answers)}, ${new Date()}, 'unread', ${answers.follow_up && answers.follow_up !== "No" ? "wanted" : "none"})`;
      return id;
    },
    async listSubmissions(formId) {
      const rows = await sql<SubmissionRow[]>`select s.id, s.form_id, f.title as form_title, s.question_snapshot, s.answers, s.submitted_at, s.review_state, s.follow_up_state
        from tools.feedback_submissions s join tools.feedback_forms f on f.id = s.form_id where s.form_id = ${formId} order by s.submitted_at desc`;
      return rows.map(submissionFromRow);
    },
    async getSubmission(id) {
      const [row] = await sql<SubmissionRow[]>`select s.id, s.form_id, f.title as form_title, s.question_snapshot, s.answers, s.submitted_at, s.review_state, s.follow_up_state
        from tools.feedback_submissions s join tools.feedback_forms f on f.id = s.form_id where s.id = ${id}`;
      return row ? submissionFromRow(row) : undefined;
    },
    async updateSubmission(id, input) {
      await sql`update tools.feedback_submissions set review_state = ${input.reviewState}, follow_up_state = ${input.followUpState} where id = ${id}`;
      return this.getSubmission(id);
    },
    async deleteSubmission(id) {
      const rows = await sql<{ id: string }[]>`delete from tools.feedback_submissions where id = ${id} returning id`;
      return rows.length === 1;
    },
    async readiness() { await sql`select 1 from tools.feedback_forms limit 1`; },
    async close() { await sql.end(); }
  };
}

function publicToken() { return randomBytes(24).toString("base64url"); }
function required<T>(value: T | undefined): T { if (!value) throw new Error("Feedback record was not found after mutation."); return value; }
function formFromRow(row: FormRow): FeedbackForm { return { id: row.id, publicToken: row.public_token, language: row.language ?? "en", title: row.title, introduction: row.introduction, questions: row.questions as FeedbackQuestion[], status: row.status, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), responseCount: row.response_count, unreadCount: row.unread_count }; }
function submissionFromRow(row: SubmissionRow): FeedbackSubmission { return { id: row.id, formId: row.form_id, formTitle: row.form_title, questionSnapshot: row.question_snapshot as FeedbackQuestion[], answers: row.answers as Record<string, string>, submittedAt: row.submitted_at.toISOString(), reviewState: row.review_state, followUpState: row.follow_up_state }; }

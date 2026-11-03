import { randomUUID } from "node:crypto";
import postgres, { type Sql, type TransactionSql } from "postgres";
import { createSealer, type Sealer } from "../../platform/security/sealed.js";
import { type Allocation, BodyshopError, type CheckIn, type FoodEntry, type SavedFood, type Setting, type TemplateComponent, type WeightReading } from "./domain.js";

/** The record types, by the kind stored in the `kind` column. */
export type BodyshopKinds = {
  food: SavedFood;
  entry: FoodEntry;
  template: TemplateComponent;
  weight: WeightReading;
  checkin: CheckIn;
  allocation: Allocation;
  setting: Setting;
};
export type BodyshopKind = keyof BodyshopKinds;
export const BODYSHOP_KINDS = ["food", "entry", "template", "weight", "checkin", "allocation", "setting"] as const satisfies readonly BodyshopKind[];

export type BodyshopChange = { [K in BodyshopKind]: { kind: K; record: BodyshopKinds[K] } | { kind: K; remove: string } }[BodyshopKind];

export type Revision<T> = Readonly<{ revision: number; removed: boolean; createdAt: string; record: T }>;

/** What an import writes. Each record carries its position in the workbook, such as "Food Log!12". */
export type ImportRecords = { [K in BodyshopKind]?: readonly { record: BodyshopKinds[K]; source: string }[] };

export type StoredImport<Receipt> = Readonly<{ id: string; digest: string; createdAt: string; receipt: Receipt }>;

/** One person's Bodyshop data. Nothing here can read another owner's rows. */
export interface BodyshopScope {
  readonly owner: string;
  /** The current records of a kind, oldest day first. `from` and `to` limit records that have a day. */
  list<K extends BodyshopKind>(kind: K, range?: { from?: string; to?: string }): Promise<BodyshopKinds[K][]>;
  /** The current records of a kind that were made in Bodyshop, not by an import. */
  native<K extends BodyshopKind>(kind: K): Promise<BodyshopKinds[K][]>;
  get<K extends BodyshopKind>(kind: K, id: string): Promise<BodyshopKinds[K] | undefined>;
  /** Writes every change as a new revision, in one transaction. A record with a new id is created. */
  save(changes: readonly BodyshopChange[]): Promise<void>;
  /** Every revision of one record, oldest first. */
  history<K extends BodyshopKind>(kind: K, id: string): Promise<Revision<BodyshopKinds[K]>[]>;
  imports<Receipt>(): Promise<StoredImport<Receipt>[]>;
  /**
   * Replaces everything that came from earlier imports with `records`, in one transaction. Records you
   * created in Bodyshop stay. The same digest again returns the first receipt and changes nothing.
   */
  commitImport<Receipt>(digest: string, receipt: Receipt, records: ImportRecords): Promise<{ receipt: Receipt; replay: boolean }>;
  /**
   * Imported records that were corrected or removed in Bodyshop, which a new import replaces. `edits` counts
   * their revisions after the first, so it grows with every later change.
   */
  changedImports(): Promise<{ records: number; edits: number }>;
  /**
   * Runs `work` in one transaction that holds this owner's write lock, so a check and the write that
   * depends on it cannot interleave with another request of the same person, on any instance.
   */
  exclusive<T>(work: (scope: BodyshopScope) => Promise<T>): Promise<T>;
}

export interface BodyshopStore {
  owner(subject: string): BodyshopScope;
  readiness(): Promise<void>;
  close(): Promise<void>;
}

type Row = { id: string; record_id: string; revision: number; removed: boolean; payload: string; created_at: Date };
type Db = Sql | TransactionSql;

export function createPostgresBodyshopStore(databaseUrl: string, options: { encryptionKey: Buffer; readOnly?: boolean }): BodyshopStore {
  return bodyshopStore(postgres(databaseUrl, { max: 3, idle_timeout: 120, connection: options.readOnly ? { default_transaction_read_only: true } : undefined }), createSealer(options.encryptionKey, "bodyshop"));
}

/** A transaction, or a savepoint when `db` is already inside one. */
function transaction<T>(db: Db, work: (inner: TransactionSql) => Promise<T>): Promise<T> {
  return ("savepoint" in db ? db.savepoint(work) : (db as Sql).begin(work)) as Promise<T>;
}

const dayOf = (record: object): string | null => "day" in record && typeof record.day === "string" ? record.day : null;

export function bodyshopStore(sql: Sql, sealer: Sealer): BodyshopStore {
  function scope(owner: string, db: Db = sql): BodyshopScope {
    if (!owner) throw new BodyshopError("A signed-in person is required.");
    // The owner and kind are part of the sealed context, so a payload cannot move to another owner or kind.
    const context = (kind: BodyshopKind, rowId: string) => `${owner}:${kind}:${rowId}`;
    const open = <K extends BodyshopKind>(kind: K, row: Row) => sealer.open<BodyshopKinds[K]>(row.payload, context(kind, row.id));

    async function insert(db: Db, kind: BodyshopKind, record: { id: string }, revision: number, extra: { removed?: boolean; importId?: string | null; source?: string | null } = {}) {
      const id = randomUUID();
      await db`insert into tools.bodyshop_records (id, owner_subject, kind, record_id, revision, current, removed, day, payload, import_id, source, created_at)
        values (${id}, ${owner}, ${kind}, ${record.id}, ${revision}, true, ${extra.removed ?? false}, ${dayOf(record)}, ${sealer.seal(record, context(kind, id))}, ${extra.importId ?? null}, ${extra.source ?? null}, now())`;
    }

    return {
      owner,
      async list(kind, range = {}) {
        const rows = await db<Row[]>`select id, record_id, revision, removed, payload, created_at from tools.bodyshop_records
          where owner_subject = ${owner} and kind = ${kind} and current and not removed
            ${range.from ? db`and day >= ${range.from}` : db``} ${range.to ? db`and day <= ${range.to}` : db``}
          order by day nulls first, created_at, id`;
        return rows.map((row) => open(kind, row));
      },
      async native(kind) {
        const rows = await db<Row[]>`select id, record_id, revision, removed, payload, created_at from tools.bodyshop_records
          where owner_subject = ${owner} and kind = ${kind} and current and not removed and import_id is null order by day nulls first, created_at, id`;
        return rows.map((row) => open(kind, row));
      },
      async get(kind, id) {
        const [row] = await db<Row[]>`select id, record_id, revision, removed, payload, created_at from tools.bodyshop_records
          where owner_subject = ${owner} and kind = ${kind} and record_id = ${id} and current and not removed`;
        return row ? open(kind, row) : undefined;
      },
      async save(changes) {
        await transaction(db, async (db) => {
          for (const change of changes) {
            const id = "remove" in change ? change.remove : change.record.id;
            const [current] = await db<(Row & { kind: string; import_id: string | null })[]>`select id, record_id, revision, removed, payload, created_at, kind, import_id from tools.bodyshop_records
              where owner_subject = ${owner} and record_id = ${id} and current for update`;
            if (current && current.kind !== change.kind) throw new BodyshopError(`This id belongs to another kind of record.`, "conflict");
            if ("remove" in change) {
              if (!current || current.removed) throw new BodyshopError("This record does not exist.", "not_found");
              await db`update tools.bodyshop_records set current = false where id = ${current.id}`;
              await insert(db, change.kind, open(change.kind, current), current.revision + 1, { removed: true, importId: current.import_id });
              continue;
            }
            if (current) await db`update tools.bodyshop_records set current = false where id = ${current.id}`;
            await insert(db, change.kind, change.record, (current?.revision ?? 0) + 1, { importId: current?.import_id ?? null });
          }
        });
      },
      async history(kind, id) {
        const rows = await db<Row[]>`select id, record_id, revision, removed, payload, created_at from tools.bodyshop_records
          where owner_subject = ${owner} and kind = ${kind} and record_id = ${id} order by revision`;
        return rows.map((row) => ({ revision: row.revision, removed: row.removed, createdAt: row.created_at.toISOString(), record: open(kind, row) }));
      },
      async imports<Receipt>() {
        const rows = await db<{ id: string; digest: string; payload: string; created_at: Date }[]>`select id, digest, payload, created_at from tools.bodyshop_imports
          where owner_subject = ${owner} order by created_at desc`;
        return rows.map((row) => ({ id: row.id, digest: row.digest, createdAt: row.created_at.toISOString(), receipt: sealer.open<Receipt>(row.payload, `${owner}:import:${row.id}`) }));
      },
      async changedImports() {
        const [row] = await db<{ records: number; edits: number }[]>`select count(*)::int records, coalesce(sum(revision - 1), 0)::int edits
          from tools.bodyshop_records where owner_subject = ${owner} and current and import_id is not null and revision > 1`;
        return row ?? { records: 0, edits: 0 };
      },
      async exclusive(work) {
        return transaction(db, async (inner) => {
          await inner`select pg_advisory_xact_lock(hashtext(${`bodyshop-write:${owner}`}))`;
          return work(scope(owner, inner));
        });
      },
      async commitImport<Receipt>(digest: string, receipt: Receipt, records: ImportRecords) {
        return transaction(db, async (db) => {
          // One import at a time per owner, so two uploads of the same file cannot both write.
          await db`select pg_advisory_xact_lock(hashtext(${`bodyshop-import:${owner}`}))`;
          const [existing] = await db<{ id: string; payload: string }[]>`select id, payload from tools.bodyshop_imports where owner_subject = ${owner} and digest = ${digest}`;
          if (existing) return { receipt: sealer.open<Receipt>(existing.payload, `${owner}:import:${existing.id}`), replay: true };
          const importId = randomUUID();
          await db`update tools.bodyshop_records set current = false where owner_subject = ${owner} and import_id is not null and current`;
          for (const kind of Object.keys(records) as BodyshopKind[]) {
            for (const { record, source } of records[kind] ?? []) await insert(db, kind, record, 1, { importId, source });
          }
          await db`insert into tools.bodyshop_imports (id, owner_subject, digest, payload, created_at)
            values (${importId}, ${owner}, ${digest}, ${sealer.seal(receipt, `${owner}:import:${importId}`)}, now())`;
          return { receipt, replay: false };
        });
      }
    };
  }

  return {
    owner: scope,
    async readiness() { await sql`select 1 from tools.bodyshop_records limit 1`; },
    async close() { await sql.end({ timeout: 5 }); }
  };
}

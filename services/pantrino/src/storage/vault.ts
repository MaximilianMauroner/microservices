import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as SQLite from "expo-sqlite";
import type { KitchenSync, Notice, OutboxItem, QueuedAction } from "../sync/model";

/** One SQLCipher store with a device-only key in the Keychain or Keystore. */
export type Vault = {
  snapshot(): Promise<KitchenSync | null>;
  saveSnapshot(snapshot: KitchenSync): Promise<void>;
  outbox(): Promise<OutboxItem[]>;
  enqueue(item: Omit<OutboxItem, "seq">): Promise<void>;
  /**
   * Stores a new snapshot, removes the changes the server answered, and keeps a notice for each change it refused.
   * One transaction, so the phone never shows a snapshot without the changes it does not yet contain.
   */
  commit(snapshot: KitchenSync, answered: readonly string[], refused: readonly Notice[]): Promise<void>;
  notices(): Promise<Notice[]>;
  dismiss(clientActionId: string): Promise<void>;
  setting(key: string): Promise<string | null>;
  saveSetting(key: string, value: string): Promise<void>;
};

const SECURE = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

/**
 * Raise this when the tables change, and add the step from the old layout to `migrate`.
 * The snapshot can be filled again by the next sync, but the outbox holds changes the server has not seen, so a step must keep them.
 */
const SCHEMA_VERSION = 1;
const SCHEMA = `
  create table if not exists settings (key text primary key, value text not null);
  create table if not exists outbox (seq integer primary key autoincrement, client_action_id text not null unique, kitchen_id text not null, queued_at text not null, action text not null);
  create table if not exists notices (client_action_id text primary key, message text not null);
`;

export type LocalVault = Pick<Vault, "snapshot" | "saveSnapshot" | "setting" | "saveSetting">;

const account = encryptedVault("kitchen.db", "kitchen.database-key", true);
export const vault = account.vault;
export const wipeVault = account.wipe;
export const localVault: LocalVault = encryptedVault("kitchen-local.db", "kitchen.local-database-key", false).vault;

function encryptedVault(file: string, keyName: string, recoverFromServer: boolean) {
  let opened: Promise<SQLite.SQLiteDatabase> | undefined;
  let wiping: Promise<void> | undefined;

  /**
   * Opens the encrypted database. A build without SQLCipher ignores the key and would write plain text,
   * so the app refuses to start when SQLCipher is missing.
   * Account data can recover from the server after a key loss. Local data has no server copy, so an unreadable local file stays for diagnosis.
   */
  function database(): Promise<SQLite.SQLiteDatabase> {
    opened ??= (async () => {
      await wiping;
      let key = await SecureStore.getItemAsync(keyName, SECURE);
      if (!key) {
        if (recoverFromServer) await SQLite.deleteDatabaseAsync(file).catch(() => undefined);
        key = Array.from(Crypto.getRandomBytes(32), (byte) => byte.toString(16).padStart(2, "0")).join("");
        await SecureStore.setItemAsync(keyName, key, SECURE);
      }
      const db = await SQLite.openDatabaseAsync(file);
      if (!(await db.getFirstAsync("PRAGMA cipher_version"))) {
        await db.closeAsync();
        throw new Error("This build has no SQLCipher. Kitchen data would not be encrypted.");
      }
      await db.execAsync(`PRAGMA key = "x'${key}'"`);
      try {
        await migrate(db);
      } catch (error) {
        await db.closeAsync();
        if (!recoverFromServer) throw error;
        await SQLite.deleteDatabaseAsync(file);
        const fresh = await SQLite.openDatabaseAsync(file);
        await fresh.execAsync(`PRAGMA key = "x'${key}'"`);
        await migrate(fresh);
        return fresh;
      }
      return db;
    })();
    opened.catch(() => { opened = undefined; });
    return opened;
  }

  const vault: Vault = {
    async snapshot() {
      const raw = await this.setting("snapshot");
      return raw ? JSON.parse(raw) as KitchenSync : null;
    },
    async saveSnapshot(snapshot) {
      await this.saveSetting("snapshot", JSON.stringify(snapshot));
    },
    async outbox() {
      const rows = await (await database()).getAllAsync<{ seq: number; client_action_id: string; kitchen_id: string; queued_at: string; action: string }>("select * from outbox order by seq");
      return rows.map((row) => ({ seq: row.seq, clientActionId: row.client_action_id, kitchenId: row.kitchen_id, queuedAt: row.queued_at, action: JSON.parse(row.action) as QueuedAction }));
    },
    async enqueue(item) {
      await (await database()).runAsync("insert into outbox (client_action_id, kitchen_id, queued_at, action) values (?, ?, ?, ?)", item.clientActionId, item.kitchenId, item.queuedAt, JSON.stringify(item.action));
    },
    async commit(snapshot, answered, refused) {
      const db = await database();
      await db.withTransactionAsync(async () => {
        await db.runAsync("insert or replace into settings (key, value) values ('snapshot', ?)", JSON.stringify(snapshot));
        for (const id of answered) await db.runAsync("delete from outbox where client_action_id = ?", id);
        for (const notice of refused) await db.runAsync("insert or replace into notices (client_action_id, message) values (?, ?)", notice.clientActionId, notice.message);
      });
    },
    async notices() {
      const rows = await (await database()).getAllAsync<{ client_action_id: string; message: string }>("select * from notices order by rowid");
      return rows.map((row) => ({ clientActionId: row.client_action_id, message: row.message }));
    },
    async dismiss(clientActionId) {
      await (await database()).runAsync("delete from notices where client_action_id = ?", clientActionId);
    },
    async setting(key) {
      return (await (await database()).getFirstAsync<{ value: string }>("select value from settings where key = ?", key))?.value ?? null;
    },
    async saveSetting(key, value) {
      await (await database()).runAsync("insert or replace into settings (key, value) values (?, ?)", key, value);
    }
  };

  async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
    const version = (await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version"))?.user_version;
    if (version === SCHEMA_VERSION) return;
    // Version 0: the first builds had no queue time. A queued change gets the time of this upgrade.
    const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(outbox)");
    const addQueuedAt = columns.length > 0 && !columns.some((column) => column.name === "queued_at")
      ? `alter table outbox add column queued_at text not null default '${new Date().toISOString()}';`
      : "";
    await db.execAsync(`${addQueuedAt} ${SCHEMA} PRAGMA user_version = ${SCHEMA_VERSION};`);
  }

  /** Deletes this vault and its key. The account vault is the only vault with a public wipe operation. */
  async function wipe(): Promise<void> {
    const previous = opened;
    opened = undefined;
    const done = (async () => {
      await wiping;
      const db = await previous?.catch(() => undefined);
      await db?.closeAsync().catch(() => undefined);
      await SQLite.deleteDatabaseAsync(file).catch(() => undefined);
      await SecureStore.deleteItemAsync(keyName, SECURE);
    })();
    wiping = done.catch(() => undefined);
    await done;
  }

  return { vault, wipe };
}

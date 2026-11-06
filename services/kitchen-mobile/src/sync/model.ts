import type { KitchenAction, KitchenSync } from "@tools-platform/service/kitchen-contract";

/** A change the person made that the server has not confirmed yet. Changes apply in `seq` order. */
export type OutboxItem = Readonly<{ seq: number; clientActionId: string; kitchenId: string; queuedAt: string; action: QueuedAction }>;

/** Every change except copying a recipe to another kitchen, which stays on the web. */
export type QueuedAction = Exclude<KitchenAction, { type: "recipe.copy" }>;

/** A change the server refused. The app shows it until the person dismisses it. */
export type Notice = Readonly<{ clientActionId: string; message: string }>;

/** What the app shows about a change that did not happen: the server refused it, or the phone could not store it. */
export type SyncNotice = Notice | Readonly<{ clientActionId: string; unsaved: true }>;

export type SyncStatus =
  | Readonly<{ kind: "idle"; syncedAt: string | null }>
  | Readonly<{ kind: "syncing" }>
  | Readonly<{ kind: "offline"; syncedAt: string | null }>
  | Readonly<{ kind: "failed"; message: string }>;

export type { KitchenSync };

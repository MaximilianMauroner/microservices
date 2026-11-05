import type { KitchenAction, KitchenSync } from "@tools-platform/service/kitchen-contract";

/** A change the person made that the server has not confirmed yet. Changes apply in `seq` order. */
export type OutboxItem = Readonly<{ seq: number; clientActionId: string; kitchenId: string; queuedAt: string; action: QueuedAction }>;

/** Every change except copying a recipe to another kitchen, which stays on the web. */
export type QueuedAction = Exclude<KitchenAction, { type: "recipe.copy" }>;

/** A change the server refused. The app shows it until the person dismisses it. */
export type Notice = Readonly<{ clientActionId: string; message: string }>;

export type SyncStatus =
  | Readonly<{ kind: "idle"; syncedAt: string | null }>
  | Readonly<{ kind: "syncing" }>
  | Readonly<{ kind: "offline"; syncedAt: string | null }>
  | Readonly<{ kind: "failed"; message: string }>;

export type { KitchenSync };

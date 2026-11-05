/** What the Kitchen app shares with the server: the domain rules, the change schema, and the sync shapes. It has no server dependency. */
export * from "./domain.js";
export { appActionBatch, kitchenAction, type AppActionResult, type KitchenAction } from "./actions.js";
export type { AppliedOutcome } from "./repository.js";
export type { KitchenSnapshot, KitchenSync } from "./sync.js";

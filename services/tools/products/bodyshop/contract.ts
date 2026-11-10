/** What the app shares with the Bodyshop server: the domain rules, the change schema, and the app snapshot. It has no server dependency. */
export * from "./domain.js";
export { bodyshopAction, type BodyshopAction } from "./actions.js";
export type { BodyshopAppSnapshot } from "./snapshot.js";

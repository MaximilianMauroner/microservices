/** What the app shares with the Bodyshop server: the domain rules, the change schema, the app snapshot, and the daily weight. It has no server dependency. */
export * from "./domain.js";
export { bodyshopAction, type BodyshopAction } from "./actions.js";
export type { BodyshopAppSnapshot, BodyshopEnergyEstimate, BodyshopTrendDay } from "./snapshot.js";
export { dailyMeanWeights, type DailyWeight } from "./model/weight.js";
export type { HealthCheckIn, HealthFeed, NutritionChange, WeightChange } from "./health-contract.js";

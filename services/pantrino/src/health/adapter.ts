import type { HealthAdapter } from "./contract";

const unavailable = async (): Promise<never> => { throw new Error("Health Connect is unavailable."); };

export const healthAdapter: HealthAdapter = {
  availability: async () => "unavailable",
  permissions: async () => [],
  request: async () => false,
  weights: unavailable,
  weightChanges: unavailable,
  stepCount: unavailable,
  sleepSessions: unavailable,
  upsertNutrition: unavailable,
  deleteNutrition: unavailable,
  openSettings() {},
};

import type { ExternalWeight, FoodEntry, Nutrients } from "./domain.js";

export type WeightChange =
  | { type: "upsert"; weight: ExternalWeight & { kg: number } }
  | { type: "delete"; externalId: string };

export type NutritionChange = {
  cursor: string;
  id: string;
  revision: number;
  food: (Pick<FoodEntry, "food" | "meal" | "day" | "time"> & { nutrients: Nutrients }) | null;
};

export type HealthFeed =
  | { kind: "baseline"; cursor: string; namespace: string; checkIns?: true }
  | { kind: "changes"; changes: NutritionChange[]; dayStartHour: number };

export type HealthCheckIn = { day: string; steps?: number; sleep?: number };

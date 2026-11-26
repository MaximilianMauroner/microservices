import type { Meal, Nutrients, WeightChange } from "@tools-platform/service/bodyshop-contract";

export const HEALTH_FEATURES = ["weight", "nutrition", "steps", "sleep"] as const;
export type HealthFeature = (typeof HEALTH_FEATURES)[number];
export type Availability = "available" | "update-required" | "unavailable";

export type NutritionRecord = {
  id: string;
  revision: number;
  name: string;
  meal: Meal;
  nutrients: Nutrients;
  start: string;
  end: string;
};

type SleepInterval = { startTime: string; endTime: string };
export type SleepSession = SleepInterval & { asleep?: SleepInterval[] };

export interface HealthAdapter {
  availability(): Promise<Availability>;
  permissions(): Promise<HealthFeature[]>;
  request(feature: HealthFeature): Promise<boolean>;
  historyAccess?(request?: boolean): Promise<boolean>;
  weights(since: string, page?: string): Promise<{ changes: WeightChange[]; next?: string }>;
  weightChanges(token?: string): Promise<{ changes: WeightChange[]; token: string; more: boolean; expired: boolean }>;
  stepCount(start: string, end: string): Promise<number | undefined>;
  sleepSessions(start: string, end: string, page?: string): Promise<{ sessions: SleepSession[]; next?: string }>;
  upsertNutrition(record: NutritionRecord): Promise<void>;
  deleteNutrition(id: string): Promise<void>;
  openSettings(): void;
}

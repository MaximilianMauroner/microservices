import type { WeightChange } from "@tools-platform/service/bodyshop-contract";
import {
  aggregateRecord, deleteRecordsByUuids, getChanges, getGrantedPermissions, getSdkStatus, initialize, insertRecords,
  MealType, openHealthConnectSettings, readRecords, RecordingMethod, requestPermission, SdkAvailabilityStatus, SleepStageType,
  type RecordResult,
} from "react-native-health-connect";
import type { HealthAdapter, HealthFeature } from "./contract";

const permissions = {
  weight: { accessType: "read", recordType: "Weight" },
  nutrition: { accessType: "write", recordType: "Nutrition" },
  steps: { accessType: "read", recordType: "Steps" },
  sleep: { accessType: "read", recordType: "SleepSession" },
} as const;

const asleepStages = new Set<number>([SleepStageType.SLEEPING, SleepStageType.LIGHT, SleepStageType.DEEP, SleepStageType.REM]);

const mealType = {
  Breakfast: MealType.BREAKFAST, Lunch: MealType.LUNCH, Dinner: MealType.DINNER,
  Snack: MealType.SNACK, Other: MealType.UNKNOWN,
};

function weightChange(record: RecordResult<"Weight">): WeightChange {
  const metadata = record.metadata;
  if (!metadata?.id || !metadata.dataOrigin || !metadata.lastModifiedTime) throw new Error("Incomplete weight record.");
  return {
    type: "upsert",
    weight: {
      provider: "health-connect", kg: record.weight.inKilograms, externalId: metadata.id,
      sourceApp: metadata.dataOrigin, measuredAt: record.time,
      offsetSeconds: record.zoneOffset?.totalSeconds ?? null, modifiedAt: metadata.lastModifiedTime,
    },
  };
}

function grams(value: number | null) {
  return value === null ? undefined : { value, unit: "grams" as const };
}

export const healthAdapter: HealthAdapter = {
  async availability() {
    const status = await getSdkStatus();
    if (status === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return "update-required";
    return status === SdkAvailabilityStatus.SDK_AVAILABLE && await initialize() ? "available" : "unavailable";
  },
  async permissions() {
    const granted = await getGrantedPermissions();
    return (Object.keys(permissions) as HealthFeature[]).filter((feature) => granted.some((permission) =>
      permission.recordType === permissions[feature].recordType && permission.accessType === permissions[feature].accessType
    ));
  },
  async request(feature) {
    const wanted = permissions[feature];
    const granted = await requestPermission([wanted]);
    return granted.some((permission) => permission.recordType === wanted.recordType && permission.accessType === wanted.accessType);
  },
  async historyAccess(request = false) {
    const permission = { accessType: "read", recordType: "ReadHealthDataHistory" } as const;
    const granted = request ? await requestPermission([permission]) : await getGrantedPermissions();
    return granted.some(({ recordType }) => recordType === permission.recordType);
  },
  async weights(since, pageToken) {
    const page = await readRecords("Weight", { timeRangeFilter: { operator: "after", startTime: since }, pageSize: 100, pageToken });
    return { changes: page.records.map(weightChange), next: page.pageToken || undefined };
  },
  async weightChanges(token) {
    const result = await getChanges(token ? { changesToken: token } : { recordTypes: ["Weight"] });
    const weight = result.upsertionChanges.flatMap(({ record }) => record.recordType === "Weight" ? [weightChange(record)] : []);
    return {
      changes: [...weight, ...result.deletionChanges.map(({ recordId }): WeightChange => ({ type: "delete", externalId: recordId }))],
      token: result.nextChangesToken, more: result.hasMore, expired: result.changesTokenExpired,
    };
  },
  async stepCount(startTime, endTime) {
    const result = await aggregateRecord({ recordType: "Steps", timeRangeFilter: { operator: "between", startTime, endTime } });
    return result.dataOrigins.length ? result.COUNT_TOTAL : undefined;
  },
  async sleepSessions(startTime, endTime, pageToken) {
    const result = await readRecords("SleepSession", { timeRangeFilter: { operator: "between", startTime, endTime }, pageToken });
    return {
      sessions: result.records.map(({ startTime, endTime, stages }) => ({
        startTime, endTime,
        asleep: stages?.some((stage) => stage.stage !== SleepStageType.UNKNOWN)
          ? stages.filter((stage) => asleepStages.has(stage.stage))
          : undefined,
      })),
      next: result.pageToken || undefined,
    };
  },
  async upsertNutrition({ id, revision, name, meal, nutrients: { kcal, protein, carbs, fat, fiber }, start, end }) {
    await insertRecords([{
      recordType: "Nutrition", name, mealType: mealType[meal], startTime: start, endTime: end,
      metadata: { clientRecordId: id, clientRecordVersion: revision, recordingMethod: RecordingMethod.RECORDING_METHOD_MANUAL_ENTRY },
      energy: kcal === null ? undefined : { value: kcal, unit: "kilocalories" },
      protein: grams(protein), totalCarbohydrate: grams(carbs), totalFat: grams(fat), dietaryFiber: grams(fiber),
    }]);
  },
  deleteNutrition: (id) => deleteRecordsByUuids("Nutrition", [], [id]),
  openSettings: openHealthConnectSettings,
};

import { addDays } from "@tools-platform/service/kitchen-contract";

export function useByStatus(useBy: string, today: string): "past" | "today" | "tomorrow" | "later" {
  if (useBy < today) return "past";
  if (useBy === today) return "today";
  return useBy === addDays(today, 1) ? "tomorrow" : "later";
}

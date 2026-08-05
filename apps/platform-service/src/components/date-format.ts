const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
] as const;

export function formatUtcTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const hour = date.getUTCHours();
  const hour12 = hour % 12 || 12;
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()} at ${hour12}:${minute} ${hour < 12 ? "AM" : "PM"} UTC`;
}

export function formatUtcDate(value: Date) {
  return `${MONTHS[value.getUTCMonth()]} ${value.getUTCDate()}, ${value.getUTCFullYear()}`;
}

export function formatUtcShortDate(value: Date) {
  return `${MONTHS[value.getUTCMonth()]} ${value.getUTCDate()}`;
}

export function formatUtcClock(value: Date) {
  return `${String(value.getUTCHours()).padStart(2, "0")}:${String(value.getUTCMinutes()).padStart(2, "0")}`;
}

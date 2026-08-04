import { useEffect, useState } from "react";

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short"
});
const shortDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric"
});
const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});
const clockFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit"
});
const zoneFormatter = new Intl.DateTimeFormat(undefined, {
  timeZoneName: "short"
});

export function LocalTimestamp({ value, fallback }: { value: string; fallback: string }) {
  const formatted = useClientFormat(value, fallback, timestampFormatter);
  return <time dateTime={value}>{formatted}</time>;
}

export function LocalDate({ value, fallback }: { value: string; fallback: string }) {
  const formatted = useClientFormat(value, fallback, shortDateFormatter);
  return <time dateTime={value}>{formatted}</time>;
}

export function LocalTimeRange({ start, end, fallback }: { start: string; end: string | null; fallback: string }) {
  const [formatted, setFormatted] = useState(fallback);
  useEffect(() => {
    const startDate = validDate(start);
    if (!startDate) return;
    const endDate = end ? validDate(end) : null;
    const zone = zoneFormatter.formatToParts(endDate ?? startDate)
      .find(({ type }) => type === "timeZoneName")?.value ?? "";
    if (!endDate) {
      setFormatted(`${clockFormatter.format(startDate)}–ongoing${zone ? ` ${zone}` : ""}`);
      return;
    }
    const sameDay = dateKeyFormatter.format(startDate) === dateKeyFormatter.format(endDate);
    setFormatted(sameDay
      ? `${clockFormatter.format(startDate)}–${clockFormatter.format(endDate)}${zone ? ` ${zone}` : ""}`
      : `${shortDateFormatter.format(startDate)} ${clockFormatter.format(startDate)}–${shortDateFormatter.format(endDate)} ${clockFormatter.format(endDate)}${zone ? ` ${zone}` : ""}`);
  }, [end, start]);
  return <>{formatted}</>;
}

function useClientFormat(value: string, fallback: string, formatter: Intl.DateTimeFormat) {
  const [formatted, setFormatted] = useState(fallback);
  useEffect(() => {
    const date = validDate(value);
    if (date) setFormatted(formatter.format(date));
  }, [formatter, value]);
  return formatted;
}

function validDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

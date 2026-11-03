/**
 * One date style across Tools: "9 Aug 2026" and "9 Aug 2026, 14:05 CEST".
 * The time zone is fixed so the server render and the browser render match.
 */
const TIME_ZONE = "Europe/Berlin";
const DAY = { day: "numeric", month: "short", year: "numeric", timeZone: TIME_ZONE } as const;
const TIME = { ...DAY, hour: "2-digit", minute: "2-digit", timeZoneName: "short" } as const;

const formatters = {
  en: { date: new Intl.DateTimeFormat("en-GB", DAY), dateTime: new Intl.DateTimeFormat("en-GB", TIME) },
  de: { date: new Intl.DateTimeFormat("de-DE", DAY), dateTime: new Intl.DateTimeFormat("de-DE", TIME) },
};

type DateInput = string | number | Date;
type Language = keyof typeof formatters;

export function formatDate(value: DateInput, language: Language = "en") {
  return formatters[language].date.format(new Date(value));
}

export function formatDateTime(value: DateInput, language: Language = "en") {
  return formatters[language].dateTime.format(new Date(value));
}

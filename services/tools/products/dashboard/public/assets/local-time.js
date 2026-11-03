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

function dateFrom(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function zoneName(date) {
  return zoneFormatter.formatToParts(date)
    .find(({ type }) => type === "timeZoneName")?.value ?? "";
}

for (const element of document.querySelectorAll("time[data-local-timestamp]")) {
  const date = dateFrom(element.dateTime);
  if (date) element.textContent = timestampFormatter.format(date);
}

for (const element of document.querySelectorAll("time[data-local-date]")) {
  const date = dateFrom(element.dateTime);
  if (date) element.textContent = shortDateFormatter.format(date);
}

for (const element of document.querySelectorAll("[data-local-time-range]")) {
  const start = dateFrom(element.dataset.start);
  if (!start) continue;

  const end = dateFrom(element.dataset.end);
  const startClock = clockFormatter.format(start);
  const zone = zoneName(end ?? start);
  if (!end) {
    element.textContent = `${startClock}–ongoing${zone ? ` ${zone}` : ""}`;
    continue;
  }

  const endClock = clockFormatter.format(end);
  const sameDay = dateKeyFormatter.format(start) === dateKeyFormatter.format(end);
  element.textContent = sameDay
    ? `${startClock}–${endClock}${zone ? ` ${zone}` : ""}`
    : `${shortDateFormatter.format(start)} ${startClock}–${shortDateFormatter.format(end)} ${endClock}${zone ? ` ${zone}` : ""}`;
}

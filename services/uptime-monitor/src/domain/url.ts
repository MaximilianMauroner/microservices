import { CheckError } from "./errors";

export function normalizeMonitorUrl(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new CheckError("network_error", "Enter a valid absolute URL"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new CheckError("network_error", "Only HTTP and HTTPS URLs are allowed");
  if (url.username || url.password) throw new CheckError("network_error", "Embedded credentials are not allowed");
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  return url.toString();
}

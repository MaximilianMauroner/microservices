import { CheckError } from "./errors.js";
import { validateLiteralTarget } from "./ip.js";

export function normalizeMonitorUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new CheckError("network_error", "Enter a valid absolute URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CheckError(
      "network_error",
      "Only HTTP and HTTPS URLs are allowed"
    );
  }
  if (url.username || url.password) {
    throw new CheckError(
      "network_error",
      "Embedded credentials are not allowed"
    );
  }
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  return url.toString();
}

export function validatedMonitorUrl(value: string): URL {
  const url = new URL(normalizeMonitorUrl(value));
  validateLiteralTarget(url.hostname);
  return url;
}

export function validatedRedirectUrl(
  location: string,
  currentUrl: URL
): URL {
  if (location.length > 2048) {
    throw new CheckError("network_error", "Redirect location is too long");
  }
  const redirected = validatedMonitorUrl(new URL(location, currentUrl).toString());
  return redirected;
}

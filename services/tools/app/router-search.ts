import { defaultParseSearch, defaultStringifySearch } from "@tanstack/react-router";

export function parseRouterSearch(search: string): Record<string, unknown> {
  const params = new URLSearchParams(search);
  if (!params.has("sig")) return defaultParseSearch(search);
  return Object.fromEntries([...new Set(params.keys())].map((key) => {
    const values = params.getAll(key);
    return [key, values.length === 1 ? values[0] : values];
  }));
}

export function stringifyRouterSearch(search: Record<string, unknown>): string {
  if (typeof search.sig !== "string") return defaultStringifySearch(search);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) params.append(key, String(item));
    }
  }
  return `?${params}`;
}

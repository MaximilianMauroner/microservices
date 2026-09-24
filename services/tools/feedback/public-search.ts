export type PublicFeedbackSearch = { submitted?: boolean; error?: string; share?: string; expires?: string; locale?: "en" | "de" };

export function parsePublicFeedbackSearch(search: Record<string, unknown>): PublicFeedbackSearch {
  return {
    submitted: search.submitted === true || search.submitted === "1" || search.submitted === 1 ? true : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
    share: typeof search.share === "string" && /^[A-Za-z0-9_-]{43}$/.test(search.share) ? search.share : undefined,
    expires: typeof search.expires === "string" && !Number.isNaN(Date.parse(search.expires)) ? search.expires : undefined,
    locale: search.locale === "de" ? "de" : search.locale === "en" ? "en" : undefined,
  };
}

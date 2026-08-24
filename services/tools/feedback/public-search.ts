export type PublicFeedbackSearch = { lang?: "en" | "de"; submitted?: boolean; error?: string };

export function parsePublicFeedbackSearch(search: Record<string, unknown>): PublicFeedbackSearch {
  return {
    lang: search.lang === "de" ? "de" : "en",
    submitted: search.submitted === true || search.submitted === "1" || search.submitted === 1 ? true : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
  };
}

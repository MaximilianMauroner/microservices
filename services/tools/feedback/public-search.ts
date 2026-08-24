export type PublicFeedbackSearch = { submitted?: boolean; error?: string };

export function parsePublicFeedbackSearch(search: Record<string, unknown>): PublicFeedbackSearch {
  return {
    submitted: search.submitted === true || search.submitted === "1" || search.submitted === 1 ? true : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
  };
}

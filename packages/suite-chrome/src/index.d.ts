export type SuiteDestination =
  | "tools"
  | "publish"
  | "review"
  | "status"
  | "manage";

export function renderSuiteChrome(active: SuiteDestination): string;

export const suiteChromeStyles: string;

/**
 * The Tools sign-in page sends the browser back to `com.lab4code.kitchen:/oauth?code=…`. The sign-in session reads that link
 * through its own listener. The app has no `/oauth` page, so the router must not open it: a link that arrives while the app
 * runs is dropped, and a link that starts the app opens the start page.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string | null {
  if (!isSignInReturn(path)) return path;
  return initial ? "/" : null;
}

export function isSignInReturn(path: string): boolean {
  return /^(?:[a-z][\w.+-]*:)?\/*oauth(?:[/?#]|$)/i.test(path);
}

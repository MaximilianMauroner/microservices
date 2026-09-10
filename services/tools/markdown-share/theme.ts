/** Manual Light / Dark / System theme override stored in the current browser. */

export type ThemeChoice = "light" | "dark" | "system";

export const DEFAULT_THEME_CHOICE: ThemeChoice = "system";

export const THEME_STORAGE_KEY = "markdown-share:theme";

export const THEME_CHOICES: readonly ThemeChoice[] = [
  "light",
  "dark",
  "system",
];

export function parseThemeChoice(value: string | null): ThemeChoice {
  if (value === "light" || value === "dark" || value === "system") {
    return value;
  }
  return DEFAULT_THEME_CHOICE;
}

export function loadThemeChoice(): ThemeChoice {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return DEFAULT_THEME_CHOICE;
    }
    return parseThemeChoice(
      window.localStorage.getItem(THEME_STORAGE_KEY),
    );
  } catch {
    return DEFAULT_THEME_CHOICE;
  }
}

export function storeThemeChoice(choice: ThemeChoice): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // The choice remains active for this session when storage is unavailable.
  }
}

export function resolveEffectiveTheme(
  choice: ThemeChoice,
  prefersDark: boolean,
): "light" | "dark" {
  if (choice === "light" || choice === "dark") {
    return choice;
  }
  return prefersDark ? "dark" : "light";
}

/** Applies the choice via data-theme; system removes the override so CSS follows the OS. */
export function applyThemeChoice(choice: ThemeChoice): void {
  if (typeof document === "undefined") {
    return;
  }
  if (choice === "system") {
    document.documentElement.removeAttribute("data-theme");
    return;
  }
  document.documentElement.setAttribute("data-theme", choice);
}

/** Reads the stored choice and applies it. Returns the active choice. */
export function applyStoredTheme(): ThemeChoice {
  const choice = loadThemeChoice();
  applyThemeChoice(choice);
  return choice;
}

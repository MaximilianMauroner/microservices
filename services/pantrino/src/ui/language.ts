import { createContext, useContext } from "react";
import { getLocales } from "expo-localization";

export const KITCHEN_LANGUAGES = ["en", "de"] as const;
export type KitchenLanguage = (typeof KITCHEN_LANGUAGES)[number];
export const LANGUAGE_NAMES: Record<KitchenLanguage, string> = { en: "English", de: "Deutsch" };
/** Kitchen is used in Austria, so German dates use Austrian month names. */
export const LOCALES: Record<KitchenLanguage, string> = { en: "en-GB", de: "de-AT" };

/** The saved choice wins. Without one, the first supported language of the phone. */
export function pickLanguage(saved: string | null): KitchenLanguage {
  if (saved === "en" || saved === "de") return saved;
  for (const locale of getLocales()) if (locale.languageCode === "de" || locale.languageCode === "en") return locale.languageCode;
  return "en";
}

export const LanguageContext = createContext<{ language: KitchenLanguage; setLanguage: (language: KitchenLanguage) => void }>({ language: "en", setLanguage: () => undefined });

export function useLanguage(): KitchenLanguage {
  return useContext(LanguageContext).language;
}

/** Picks the strings of the reader's language. Each screen keeps its own `{ en, de }` table, as on the web. */
export function useText<T>(text: Record<KitchenLanguage, T>): T {
  return text[useLanguage()];
}

import { useRouter } from "@tanstack/react-router";
import { createContext, useContext } from "react";

export const KITCHEN_LANGUAGES = ["en", "de"] as const;
export type KitchenLanguage = (typeof KITCHEN_LANGUAGES)[number];

export const LANGUAGE_COOKIE = "kitchen-language";
export const LANGUAGE_NAMES: Record<KitchenLanguage, string> = { en: "English", de: "Deutsch" };
/** Kitchen is used in Austria, so German dates use Austrian month names. */
export const LOCALES: Record<KitchenLanguage, string> = { en: "en-GB", de: "de-AT" };

/** The saved choice wins. Without one, the first supported language that the browser asks for. */
export function pickLanguage(saved: string | undefined, acceptLanguage: string | undefined): KitchenLanguage {
  if (saved === "en" || saved === "de") return saved;
  for (const part of (acceptLanguage ?? "").split(",")) {
    const tag = part.trim().slice(0, 2).toLowerCase();
    if (tag === "en" || tag === "de") return tag;
  }
  return "en";
}

const LanguageContext = createContext<KitchenLanguage>("en");
export const LanguageProvider = LanguageContext.Provider;

export function useLanguage(): KitchenLanguage {
  return useContext(LanguageContext);
}

/** Picks the strings of the reader's language. Each file keeps its own `{ en, de }` table, typed by its `en` half. */
export function useText<T>(text: Record<KitchenLanguage, T>): T {
  return text[useLanguage()];
}

/** Saves the choice for a year in this browser and renders the pages again in that language. */
export function useSetLanguage() {
  const router = useRouter();
  return async (language: KitchenLanguage) => {
    document.cookie = `${LANGUAGE_COOKIE}=${language}; path=/; max-age=31536000; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
    await router.invalidate();
  };
}

import { useColorScheme } from "react-native";

/**
 * The tab of a page. Each Kitchen page takes its produce color, as on the web. The Kitchen tab keeps the color of
 * Ingredients, which it holds. `today` and `foods` are the Bodyshop pages in the web Bodyshop colors. Search is neutral.
 */
export type PageKey = "week" | "shopping" | "recipes" | "home" | "kitchen" | "today" | "foods" | "search";

/** Colors copied from services/tools/app/styles.css, so the app looks like the web Kitchen in both themes. */
const dark = {
  background: "#000000",
  foreground: "#ffffff",
  card: "#080808",
  muted: "#151515",
  mutedForeground: "#ababab",
  border: "#252525",
  control: "#121212",
  controlBorder: "#4a4a4a",
  destructive: "#ff7474",
  positive: "#6ee7b7",
  ripple: "rgba(255,255,255,0.14)",
  warning: "#fcd34d",
  page: { week: "#c4402b", shopping: "#1f7d47", recipes: "#7343b5", home: "#2366ad", kitchen: "#b4521a", today: "#b8452f", foods: "#1d7a50", search: "#525252" },
  pageInk: { week: "#ff8a73", shopping: "#5fd08f", recipes: "#c3a2f5", home: "#7db7f2", kitchen: "#f5a066", today: "#ef7d6b", foods: "#5cbf8a", search: "#d4d4d4" },
  /** Bodyshop nutrient colors from services/tools/app/styles.css. */
  nutrient: { kcal: "#f2b85a", protein: "#6fb0f0", carbs: "#f2b85a", fat: "#e47ba6", fiber: "#5cbf8a" },
  groups: ["#ef7d6b", "#aebf55", "#d8a46c", "#5cbf8a", "#a8a29e", "#b38be0", "#63aee0", "#e47ba6"]
};

const light: typeof dark = {
  background: "#fafafa",
  foreground: "#171717",
  card: "#ffffff",
  muted: "#f3f3f3",
  mutedForeground: "#686868",
  border: "#dedede",
  control: "#ffffff",
  controlBorder: "#c4c4c4",
  destructive: "#c73333",
  positive: "#047857",
  ripple: "rgba(0,0,0,0.10)",
  warning: "#b45309",
  page: dark.page,
  pageInk: dark.page,
  nutrient: { kcal: "#dc9415", protein: "#2a6fbd", carbs: "#dc9415", fat: "#c2477d", fiber: "#23935d" },
  groups: ["#d4503b", "#74841a", "#b0712c", "#23935d", "#78716c", "#8655c4", "#2a7fbd", "#c24a7d"]
};

export type Colors = typeof dark;

export const RADIUS = 12;
export const FONT = { regular: "InstrumentSans_400Regular", medium: "InstrumentSans_500Medium", semibold: "InstrumentSans_600SemiBold", bold: "InstrumentSans_700Bold" };

export function useColors(): Colors {
  return useColorScheme() === "light" ? light : dark;
}

/** A food color mixed into the card surface, like `color-mix(in srgb, color percent%, card)` on the web. */
export function tint(color: string, percent: number, base: string): string {
  const [r1, g1, b1] = rgb(color);
  const [r2, g2, b2] = rgb(base);
  const mix = (a: number, b: number) => Math.round((a * percent + b * (100 - percent)) / 100).toString(16).padStart(2, "0");
  return `#${mix(r1, r2)}${mix(g1, g2)}${mix(b1, b2)}`;
}

/** The color of a food group, as on the web: its place in the kitchen's group order picks one of eight hues. */
export function groupColor(colors: Colors, groups: readonly string[], group: string): string {
  if (group === "Other") return colors.mutedForeground;
  let index = groups.indexOf(group);
  if (index === -1) index = [...group].reduce((sum, letter) => sum + letter.charCodeAt(0), 0);
  return colors.groups[index % 8]!;
}

/** A food color moved toward the text color, so small text in it stays readable. */
export function ink(color: string, colors: Colors): string {
  return tint(color, 72, colors.foreground);
}

function rgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

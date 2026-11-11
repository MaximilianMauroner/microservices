import type { KitchenLanguage } from "../language";

const en = {
  title: "Today", tonight: "Tonight", planDinner: "Plan dinner", noDinner: "Nothing planned for tonight.",
  recipe: "Recipe", change: "Change", cooked: "Cooked", useFirst: "Use first", tomorrow: "Tomorrow",
  noTomorrow: "Nothing planned yet.", noLeftovers: "No leftovers to use up.", leftovers: "Leftovers",
  toBuy: (count: number) => `${count} to buy this week`,
  more: (names: readonly string[], count: number) => `${names.join(", ")}${count > names.length ? ` and ${count - names.length} more` : ""}`,
  allBought: "Everything is at home.", thisWeek: "This week", nothingPlanned: "Nothing planned", openList: "Open list",
};
export const TEXT: Record<KitchenLanguage, typeof en> = {
  en,
  de: {
    title: "Heute", tonight: "Heute Abend", planDinner: "Abendessen planen", noDinner: "Für heute Abend ist nichts geplant.",
    recipe: "Rezept", change: "Ändern", cooked: "Gekocht", useFirst: "Zuerst verbrauchen", tomorrow: "Morgen",
    noTomorrow: "Noch nichts geplant.", noLeftovers: "Keine Reste zum Verbrauchen.", leftovers: "Reste",
    toBuy: (count: number) => `${count} diese Woche einkaufen`,
    more: (names: readonly string[], count: number) => `${names.join(", ")}${count > names.length ? ` und ${count - names.length} weitere` : ""}`,
    allBought: "Alles ist im Vorrat.", thisWeek: "Diese Woche", nothingPlanned: "Nichts geplant", openList: "Liste öffnen",
  },
};

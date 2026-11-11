import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import type { Loggable } from "../../body/model";
import { bodyStore, useBody } from "../../body/store";
import { useKitchen } from "../../state";
import { HitRow, LogSheet } from "../body/log-sheet";
import { TEXT as BODY_TEXT } from "../body/text";
import { Button, useKitText, type Notice, PageContext, Screen, SearchField, Snackbar, T } from "../kit";
import { type KitchenLanguage, useText } from "../language";
import { search, type SearchHit, searchIndex } from "./model";

const en = {
  title: "Search",
  label: "Recipes, ingredients, and foods",
  hint: "One search finds your Kitchen recipes and ingredients and your Bodyshop foods and meals.",
  kitchenHint: "Search finds your recipes and ingredients.",
  noMatch: (query: string) => `Nothing in Kitchen or Bodyshop matches “${query}”`,
  noKitchenMatch: (query: string) => `No recipe or ingredient matches “${query}”`,
  log: "Log",
  logNamed: (name: string) => `Log ${name} in Bodyshop`,
};
const TEXT: Record<KitchenLanguage, typeof en> = {
  en,
  de: {
    title: "Suche",
    label: "Rezepte, Zutaten und Lebensmittel",
    hint: "Eine Suche findet deine Rezepte und Zutaten aus der Küche und deine Lebensmittel und Mahlzeiten aus Bodyshop.",
    kitchenHint: "Die Suche findet deine Rezepte und Zutaten.",
    noMatch: (query: string) => `Nichts in Küche oder Bodyshop passt zu „${query}“`,
    noKitchenMatch: (query: string) => `Kein Rezept und keine Zutat passt zu „${query}“`,
    log: "Eintragen",
    logNamed: (name: string) => `${name} in Bodyshop eintragen`,
  },
};

/**
 * Searches Kitchen and Bodyshop at once, whichever product is open. Without Bodyshop it searches the kitchen only. A tap opens the hit where it lives. A Kitchen recipe or
 * ingredient can also go straight into the Bodyshop log.
 */
export function SearchPage() {
  const text = useText(TEXT);
  const kitText = useKitText();
  const bodyText = useText(BODY_TEXT);
  const kitchen = useKitchen();
  const body = useBody();
  const [query, setQuery] = useState("");
  const [logging, setLogging] = useState<Loggable>();
  const [notice, setNotice] = useState<Notice | null>(null);
  const bodyshop = body.status !== "no-access" ? body.snapshot : null;
  const hits = search(searchIndex(kitchen?.kitchen ?? null, bodyshop), query);

  async function open(hit: SearchHit) {
    if (hit.kind === "recipe") router.navigate({ pathname: "/kitchen/[recipeId]", params: { recipeId: hit.id } });
    else if (hit.kind === "ingredient") router.navigate({ pathname: "/kitchen", params: { list: "ingredients", open: hit.id } });
    else if (hit.loggable) setLogging(hit.loggable);
    else if (bodyshop) {
      const result = await bodyStore.act({ type: "meal.log", day: bodyshop.day, template: hit.id });
      setNotice({ message: result.ok ? bodyText.logged(hit.label) : result.reason === "refused" ? result.message ?? bodyText.failed : result.reason === "offline" ? bodyText.needsConnection : bodyText.failed });
    }
  }

  return (
    <PageContext.Provider value="today">
      <Screen title={text.title} back={{ label: kitText.back, onPress: () => router.back() }} floating={<Snackbar notice={notice} onUndo={() => undefined} onDone={() => setNotice(null)} />}>
        <SearchField value={query} onValue={setQuery} label={text.label} />
        {!query.trim() ? <T muted>{bodyshop ? text.hint : text.kitchenHint}</T> : null}
        <View style={{ gap: 2 }}>
          {hits.map((hit) => (
            <HitRow key={hit.key} hit={hit} onPress={() => void open(hit)}
              action={hit.product === "kitchen" && bodyshop && hit.loggable
                ? <Button tone="outline" compact label={text.log} accessibilityLabel={text.logNamed(hit.label)} onPress={() => setLogging(hit.loggable)} />
                : undefined} />
          ))}
          {query.trim() && !hits.length ? <T muted style={{ padding: 16, textAlign: "center" }}>{bodyshop ? text.noMatch(query.trim()) : text.noKitchenMatch(query.trim())}</T> : null}
        </View>
        {logging ? <LogSheet initial={logging} onClose={() => setLogging(undefined)} notify={setNotice} /> : null}
      </Screen>
    </PageContext.Provider>
  );
}

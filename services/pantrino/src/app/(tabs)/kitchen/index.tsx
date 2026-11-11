import { router, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { Ingredients } from "../../../ui/ingredients/page";
import { Pantry } from "../../../ui/home/page";
import { Press, T, usePageColor } from "../../../ui/kit";
import { type KitchenLanguage, useText } from "../../../ui/language";
import { KitchenScreen } from "../../../ui/page";
import { Recipes } from "../../../ui/recipes/page";
import { useColors } from "../../../ui/theme";

const en = { recipes: "Recipes", home: "At home", ingredients: "Ingredients", kitchen: "Kitchen" };
const TEXT: Record<KitchenLanguage, typeof en> = { en, de: { recipes: "Rezepte", home: "Vorrat", ingredients: "Zutaten", kitchen: "Küche" } };

export default function KitchenPage() {
  const { list } = useLocalSearchParams<{ list?: string }>();
  const selected = list === "home" || list === "ingredients" ? list : "recipes";
  return <KitchenScreen page="kitchen">{(data) => {
    const top = <KitchenLists selected={selected} />;
    return selected === "home" ? <Pantry key={data.kitchen.kitchen.id} {...data} top={top} />
      : selected === "ingredients" ? <Ingredients key={data.kitchen.kitchen.id} data={data} top={top} />
      : <Recipes key={data.kitchen.kitchen.id} data={data} top={top} />;
  }}</KitchenScreen>;
}

function KitchenLists({ selected }: { selected: "recipes" | "home" | "ingredients" }) {
  const text = useText(TEXT);
  const colors = useColors();
  const page = usePageColor();
  return <View accessibilityRole="tablist" accessibilityLabel={text.kitchen} style={{ flexDirection: "row", flexWrap: "wrap", padding: 4, borderRadius: 16, backgroundColor: colors.muted, gap: 8 }}>
    {(["recipes", "home", "ingredients"] as const).map((list) => <Press key={list} accessibilityRole="tab" accessibilityState={{ selected: selected === list }}
      onPress={() => router.setParams({ list })} style={{ flexGrow: 1, minHeight: 48, padding: 8, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: selected === list ? page.hue : "transparent" }}>
      <T weight="medium" style={{ color: selected === list ? "#ffffff" : colors.foreground }}>{text[list]}</T>
    </Press>)}
  </View>;
}

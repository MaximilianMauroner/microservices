import { router } from "expo-router";
import { View } from "react-native";
import { Press, T, usePageColor } from "../kit";
import { type KitchenLanguage, useText } from "../language";
import { useColors } from "../theme";

const en = { recipes: "Recipes", home: "At home", ingredients: "Ingredients", kitchen: "Kitchen" };
const TEXT: Record<KitchenLanguage, typeof en> = { en, de: { recipes: "Rezepte", home: "Vorrat", ingredients: "Zutaten", kitchen: "Küche" } };

export function KitchenLists({ selected }: { selected: "recipes" | "home" | "ingredients" }) {
  const text = useText(TEXT);
  const colors = useColors();
  const page = usePageColor();
  return <View accessibilityRole="tablist" accessibilityLabel={text.kitchen} style={{ flexDirection: "row", flexWrap: "wrap", padding: 4, borderRadius: 16, backgroundColor: colors.muted, gap: 8 }}>
    {(["recipes", "home", "ingredients"] as const).map((list) => <Press key={list} accessibilityRole="tab" accessibilityState={{ selected: selected === list }}
      onPress={() => router.navigate({ pathname: "/kitchen", params: { list } })} style={{ flexGrow: 1, minHeight: 48, padding: 8, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: selected === list ? page.hue : "transparent" }}>
      <T weight="medium" style={{ color: selected === list ? "#ffffff" : colors.foreground }}>{text[list]}</T>
    </Press>)}
  </View>;
}

import { CATALOG_SOURCE_NAMES, formatNumber, type CatalogProduct } from "@tools-platform/service/kitchen-contract";
import { useEffect, useState } from "react";
import { Linking, View } from "react-native";
import { searchCatalog } from "../../sync/api";
import { Press, T } from "../kit";
import { useLanguage, useText } from "../language";
import { useColors } from "../theme";
import { TEXT } from "./text";

/** Packaged foods that match the typed name. Picking one fills in the name, the unit, and the nutrition. Offline, the list stays away. */
export function CatalogProducts({ query, onPick }: { query: string; onPick: (product: CatalogProduct) => void }) {
  const language = useLanguage();
  const text = useText(TEXT);
  const colors = useColors();
  const [products, setProducts] = useState<readonly CatalogProduct[]>([]);
  useEffect(() => {
    const typed = query.trim();
    let current = true;
    const timer = setTimeout(() => {
      if (typed.length < 2) return setProducts([]);
      searchCatalog(typed).then((found) => { if (current) setProducts(found); }, () => { if (current) setProducts([]); });
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [query]);
  if (!products.length) return null;

  return (
    <View style={{ gap: 6, paddingTop: 4 }}>
      <T muted weight="medium" style={{ fontSize: 12 }}>{text.fromProduct}</T>
      <View style={{ borderRadius: 16, borderWidth: 1, borderColor: colors.controlBorder, backgroundColor: colors.control, overflow: "hidden" }}>
        {products.map((product, index) => (
          <Press key={product.code} accessibilityRole="button" onPress={() => onPick(product)}
            style={({ pressed }) => ({ minHeight: 48, justifyContent: "center", gap: 2, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: index ? 1 : 0, borderTopColor: colors.controlBorder, backgroundColor: pressed ? colors.muted : "transparent" })}>
            <T weight="medium" style={{ fontSize: 14 }}>{product.name}</T>
            <T muted style={{ fontSize: 12 }}>
              {[product.brand, product.quantity, product.nutrition.kcal !== null ? `${formatNumber(product.nutrition.kcal, language)} ${text.kcal} ${text.per100(product.unit)}` : "", CATALOG_SOURCE_NAMES[product.source]].filter(Boolean).join(" · ")}
            </T>
          </Press>
        ))}
      </View>
      <Press accessibilityRole="link" onPress={() => void Linking.openURL("https://world.openfoodfacts.org")}>
        <T muted style={{ fontSize: 12, textDecorationLine: "underline" }}>{text.catalogSource}</T>
      </Press>
    </View>
  );
}

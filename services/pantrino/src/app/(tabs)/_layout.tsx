import { router, Tabs, useSegments } from "expo-router";
import { Search } from "lucide-react-native";
import { type ComponentProps, useEffect, useRef } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useBody } from "../../body/store";
import { type Product, useApp } from "../../state";
import { useSyncAlert } from "../../ui/kitchen/page";
import { BODY_PAGES, Button, PAGES, Press, SEARCH_PAGE, T, useKitText } from "../../ui/kit";
import { type KitchenLanguage, useText } from "../../ui/language";
import { tint, useColors } from "../../ui/theme";
import { ContentLayoutContext, useContentLayout, useWindowLayout } from "../../ui/responsive";

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

const en = { kitchen: "Kitchen", bodyshop: "Bodyshop", products: "Kitchen or Bodyshop", search: "Search Kitchen and Bodyshop", searchKitchen: "Search the kitchen" };
const TEXT: Record<KitchenLanguage, typeof en> = {
  en,
  de: { kitchen: "Küche", bodyshop: "Bodyshop", products: "Küche oder Bodyshop", search: "Küche und Bodyshop durchsuchen", searchKitchen: "Küche durchsuchen" },
};

const PRODUCT_PAGES: Readonly<Record<Product, typeof PAGES>> = { kitchen: PAGES, bodyshop: BODY_PAGES };
const FIRST_PATH: Readonly<Record<Product, "/" | "/bodyshop">> = { kitchen: "/", bodyshop: "/bodyshop" };

/** The product a tab route belongs to. Search belongs to neither and keeps the open product. */
function productOf(route: string | undefined): Product | undefined {
  return (Object.keys(PRODUCT_PAGES) as Product[]).find((product) => PRODUCT_PAGES[product].some((page) => page.route === route));
}

export default function KitchenTabs() {
  const colors = useColors();
  const segments = useSegments();
  const layout = useWindowLayout(segments.length <= 2);
  return (
    <ContentLayoutContext value={layout}>
      <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: colors.background }}>
        {segments.length <= 2 ? <ProductBar /> : null}
        <Tabs screenOptions={{ headerShown: false, tabBarPosition: layout.navigation === "rail" ? "left" : "bottom", sceneStyle: { backgroundColor: colors.background } }} tabBar={(props) => <TabBar {...props} />}>
          {[...PAGES, ...BODY_PAGES, SEARCH_PAGE].map((one) => <Tabs.Screen key={one.key} name={one.route} />)}
        </Tabs>
      </SafeAreaView>
    </ContentLayoutContext>
  );
}

/**
 * Switches between Kitchen and Bodyshop, and opens the search over both. Without Bodyshop (no access, or no account)
 * there is no switch, only the search, so Kitchen looks as before.
 */
function ProductBar() {
  const text = useText(TEXT);
  const colors = useColors();
  const { product } = useApp();
  const body = useBody();
  const layout = useContentLayout();
  const both = body.status !== "no-access" && body.status !== "unknown";
  return (
    <View style={[styles.productBar, { paddingHorizontal: layout.gutter, borderBottomColor: colors.border }]}>
      {both ? (
        <View accessibilityRole="tablist" accessibilityLabel={text.products} style={[styles.products, { backgroundColor: colors.muted }]}>
          {(["kitchen", "bodyshop"] as const).map((one) => {
            const active = one === (product ?? "kitchen");
            const ink = colors.pageInk[PRODUCT_PAGES[one][0]!.key];
            return (
              <Press key={one} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => { if (!active) router.navigate(FIRST_PATH[one]); }}
                style={[styles.product, active && { backgroundColor: tint(ink, 22, colors.background) }]}>
                <T weight={active ? "semibold" : "medium"} muted={!active} style={{ fontSize: 14 }}>{text[one]}</T>
              </Press>
            );
          })}
        </View>
      ) : <View />}
      <Button tone="ghost" icon={Search} accessibilityLabel={both ? text.search : text.searchKitchen} onPress={() => router.navigate("/search")} />
    </View>
  );
}

function TabBar({ state, navigateToTab }: TabBarProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const text = useKitText();
  const alert = useSyncAlert();
  const segments = useSegments();
  const layout = useContentLayout();
  const rail = layout.navigation === "rail";
  const current = state.routes[state.index];
  const { product, setProduct, session } = useApp();
  const body = useBody();
  const shown = productOf(current?.name);
  const launched = useRef(false);
  useEffect(() => {
    if (!product) return;
    // The app starts on the Week tab. A person who left it in Bodyshop gets Bodyshop back.
    if (!launched.current) {
      launched.current = true;
      if (current?.name === PAGES[0]!.route && product !== "kitchen") { router.replace(FIRST_PATH[product]); return; }
    }
    if (shown && shown !== product) setProduct(shown);
  }, [shown, product, setProduct, current?.name]);
  useEffect(() => {
    // No access, or no account: Bodyshop is gone, so its tabs go too.
    if ((body.status === "no-access" || session !== "signed-in") && shown === "bodyshop") router.navigate(FIRST_PATH.kitchen);
  }, [body.status, session, shown]);
  if (segments.length > 2) return null;
  return (
    <ScrollView horizontal={!rail} scrollEnabled={rail} scrollsToTop={false} showsVerticalScrollIndicator={false}
      style={rail ? { width: layout.railWidth, flexGrow: 0, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border } : { flexGrow: 0 }}
      contentContainerStyle={[styles.bar, rail && styles.rail, { borderTopColor: colors.border, backgroundColor: colors.background, paddingBottom: insets.bottom }]}>
      {PRODUCT_PAGES[product ?? "kitchen"].map((page) => {
        const active = page.route === current?.name;
        const ink = colors.pageInk[page.key];
        const marked = page.key === "kitchen" ? alert : null;
        return (
          <Press
            key={page.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={marked ? `${text.tabs[page.key][0]}, ${marked.label}` : text.tabs[page.key][0]}
            onPress={() => { const route = state.routes.find((one) => one.name === page.route); if (route) navigateToTab(route.key); }}
            style={[styles.tab, rail && styles.railTab]}
          >
            <View style={styles.icon}>
              {/* Android drops the corner radius when a mounted view changes its background, so the highlight mounts with its tab. */}
              {active ? <View style={[StyleSheet.absoluteFill, styles.highlight, { backgroundColor: tint(ink, 18, colors.background) }]} /> : null}
              <page.icon size={19} color={ink} />
              {marked ? <View style={[styles.dot, { backgroundColor: marked.warn ? colors.destructive : colors.mutedForeground, borderColor: colors.background }]} /> : null}
            </View>
            <T weight="medium" muted={!active} style={{ fontSize: rail ? 12 : 11, textAlign: "center" }}>{text.tabs[page.key][1]}</T>
          </Press>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  productBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingVertical: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  products: { flexDirection: "row", padding: 3, borderRadius: 22, gap: 2 },
  product: { minHeight: 40, paddingHorizontal: 16, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  bar: { flexDirection: "row", flexGrow: 1, borderTopWidth: StyleSheet.hairlineWidth },
  rail: { flexDirection: "column", borderTopWidth: 0, paddingTop: 12, gap: 8 },
  railTab: { flex: 0, minHeight: 72, paddingVertical: 8, paddingHorizontal: 4 },
  tab: { flex: 1, minHeight: 64, paddingVertical: 6, alignItems: "center", justifyContent: "center", gap: 4 },
  icon: { height: 28, width: 48, alignItems: "center", justifyContent: "center" },
  highlight: { borderRadius: 14 },
  dot: { position: "absolute", top: 2, right: 10, width: 10, height: 10, borderRadius: 5, borderWidth: 2 }
});

import { useFocusEffect } from "expo-router";
import { createContext, isValidElement, useCallback, useContext, useEffect, useMemo } from "react";
import { BackHandler, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { paneWidths, windowLayout, type WindowLayout } from "./layout";

export const ContentLayoutContext = createContext<WindowLayout | null>(null);

export function useWindowLayout(tabsVisible = false): WindowLayout {
  const { width, height, fontScale } = useWindowDimensions();
  const { top, left, right, bottom } = useSafeAreaInsets();
  return useMemo(() => windowLayout({ width, height, fontScale }, { top, left, right, bottom }, tabsVisible),
    [width, height, fontScale, top, left, right, bottom, tabsVisible]);
}

export function useContentLayout(): WindowLayout {
  const layout = useContext(ContentLayoutContext);
  if (!layout) throw new Error("useContentLayout needs ContentLayoutContext.");
  return layout;
}

/** `onBack` closes the open detail pane. A compact window shows the detail as a modal or a route, which handle Back already. */
export function Workspace({ children, detail, replace = false, selected = false, onBack }: {
  children: React.ReactNode; detail: React.ReactNode; replace?: boolean; selected?: boolean; onBack?: () => void;
}) {
  const layout = useContentLayout();
  const wide = layout.panes > 1;
  useFocusEffect(useCallback(() => {
    if (!wide || !onBack) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { onBack(); return true; });
    return () => subscription.remove();
  }, [wide, onBack]));
  const [left, right] = paneWidths(layout);
  const opacity = useSharedValue(1);
  const detailKey = isValidElement(detail) ? detail.key : null;
  useEffect(() => {
    opacity.value = 0;
    opacity.value = withTiming(1, { duration: 200, reduceMotion: ReduceMotion.Never });
  }, [wide, detailKey, opacity]);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const inPane = (width: number): WindowLayout => ({ ...layout, panes: 1, railWidth: 0, contentWidth: Math.max(0, Math.min(720, width - 2 * layout.gutter)) });
  return <View style={{ flex: 1, flexDirection: "row" }}>
    <View style={wide ? { width: left } : { flex: 1, display: replace && selected ? "none" : "flex" }}>
      <ContentLayoutContext value={wide ? inPane(left) : layout}>{children}</ContentLayoutContext>
    </View>
    <Animated.View style={[wide ? { width: right } : replace && selected ? { flex: 1 } : { position: "absolute", width: 0, height: 0 }, fade]}>
      <ContentLayoutContext value={wide ? inPane(right) : layout}>{detail}</ContentLayoutContext>
    </Animated.View>
  </View>;
}

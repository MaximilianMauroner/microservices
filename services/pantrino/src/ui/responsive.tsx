import { createContext, useContext, useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { windowLayout, type WindowLayout } from "./layout";

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

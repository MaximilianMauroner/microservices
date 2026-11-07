import { createContext, useContext } from "react";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { windowLayout, type WindowLayout } from "./layout";

export const ContentLayoutContext = createContext<WindowLayout | null>(null);

export function useWindowLayout(tabsVisible = false): WindowLayout {
  return windowLayout(useWindowDimensions(), useSafeAreaInsets(), tabsVisible);
}

export function useContentLayout(): WindowLayout {
  const layout = useContext(ContentLayoutContext);
  const fallback = useWindowLayout();
  return layout ?? fallback;
}

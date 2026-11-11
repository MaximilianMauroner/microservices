type WindowSize = Readonly<{ width: number; height: number; fontScale: number }>;
type Insets = Readonly<{ top: number; right: number; bottom: number; left: number }>;

export type WindowLayout = Readonly<{
  usableWidth: number;
  windowClass: "compact" | "medium" | "expanded";
  panes: 1 | 2 | 3;
  navigation: "bottom" | "rail";
  railWidth: number;
  gutter: number;
  contentWidth: number;
  bottomInset: number;
  sheetWidth: number;
  sheetGap: number;
}>;

export function windowLayout(window: WindowSize, insets: Insets, tabsVisible = true): WindowLayout {
  const usableWidth = Math.max(0, window.width - insets.left - insets.right);
  const usableHeight = Math.max(0, window.height - insets.top - insets.bottom);
  const windowClass = usableWidth < 600 ? "compact" : usableWidth < 840 ? "medium" : "expanded";
  const panes = windowClass === "compact" ? 1 : windowClass === "medium" ? 2 : 3;
  const navigation = windowClass === "compact" ? "bottom" : "rail";
  const railWidth = navigation === "rail" && tabsVisible ? 96 : 0;
  const gutter = 16;
  const contentWidth = Math.max(0, Math.min(panes * 720 + (panes - 1) * 32, usableWidth - railWidth - 2 * gutter));
  const sheetGap = usableWidth >= 600 && usableHeight >= 480 ? 16 : 0;
  return {
    usableWidth, windowClass, panes, navigation, railWidth, gutter, contentWidth,
    bottomInset: tabsVisible && navigation === "bottom" ? 0 : insets.bottom,
    sheetWidth: Math.min(640, usableWidth - 2 * sheetGap), sheetGap,
  };
}

export function paneWidths(layout: WindowLayout): readonly [number, number] {
  return [layout.usableWidth / 2 - layout.railWidth, layout.usableWidth / 2];
}

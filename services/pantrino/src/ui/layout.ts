type WindowSize = Readonly<{ width: number; height: number; fontScale: number }>;
type Insets = Readonly<{ top: number; right: number; bottom: number; left: number }>;

export type WindowLayout = Readonly<{
  usableWidth: number;
  usableHeight: number;
  navigation: "bottom" | "rail";
  railWidth: number;
  gutter: number;
  contentWidth: number;
  columns: 1 | 2 | 3;
  detailColumns: 1 | 2;
  bottomInset: number;
  sheetWidth: number;
  sheetGap: number;
}>;

export function windowLayout(window: WindowSize, insets: Insets, tabsVisible = true): WindowLayout {
  const usableWidth = Math.max(0, window.width - insets.left - insets.right);
  const usableHeight = Math.max(0, window.height - insets.top - insets.bottom);
  const scale = Math.max(1, window.fontScale);
  const navigation = usableWidth >= 720 ? "rail" : "bottom";
  const railWidth = navigation === "rail" && tabsVisible ? 96 : 0;
  const pageWidth = usableWidth - railWidth;
  const gutter = pageWidth >= 600 ? 24 : 16;
  const contentWidth = Math.max(0, Math.min(1200, pageWidth - 2 * gutter));
  const columns = contentWidth >= 3 * 280 * scale + 32 ? 3 : contentWidth >= 2 * 280 * scale + 16 ? 2 : 1;
  const sheetGap = usableWidth >= 600 && usableHeight >= 480 ? 16 : 0;
  return {
    usableWidth, usableHeight, navigation, railWidth, gutter, contentWidth, columns,
    detailColumns: contentWidth >= 680 * scale ? 2 : 1,
    bottomInset: tabsVisible && navigation === "bottom" ? 0 : insets.bottom,
    sheetWidth: Math.min(640, usableWidth - 2 * sheetGap), sheetGap,
  };
}

import { describe, expect, it } from "vitest";
import { windowLayout } from "./layout";

const noInsets = { top: 0, left: 0, right: 0, bottom: 0 };
const window = (width: number, height: number, fontScale = 1) => ({ width, height, fontScale });

describe("Pantrino's available window", () => {
  it("keeps phone and narrow split-screen content in one column above bottom tabs", () => {
    for (const width of [320, 390, 507]) {
      const layout = windowLayout(window(width, 844), { ...noInsets, top: 59, bottom: 34 });
      expect(layout.navigation).toBe("bottom");
      expect(layout.columns).toBe(1);
      expect(layout.railWidth).toBe(0);
      expect(layout.bottomInset).toBe(0);
      expect(layout.contentWidth + 2 * layout.gutter).toBe(width);
    }
  });

  it("uses more columns as a window unfolds or expands and returns to the phone layout", () => {
    const layouts = [390, 768, 1024, 390].map((width) => windowLayout(window(width, 900), noInsets));
    expect(layouts.map((layout) => layout.columns)).toEqual([1, 2, 3, 1]);
    expect(layouts.map((layout) => layout.navigation)).toEqual(["bottom", "rail", "rail", "bottom"]);
    expect(layouts[3]).toEqual(layouts[0]);
  });

  it("chooses navigation from usable width after horizontal safe areas", () => {
    const layout = windowLayout(window(800, 600), { ...noInsets, left: 48, right: 48 });
    expect(layout.navigation).toBe("bottom");
    expect(layout.usableWidth).toBe(704);
    expect(layout.contentWidth + 2 * layout.gutter).toBe(704);
  });

  it("gives detail routes the rail's space and protects their bottom controls", () => {
    const insets = { ...noInsets, bottom: 24 };
    const list = windowLayout(window(768, 1024), insets);
    const detail = windowLayout(window(768, 1024), insets, false);
    expect(detail.contentWidth - list.contentWidth).toBe(list.railWidth);
    expect(detail.railWidth).toBe(0);
    expect(detail.detailColumns).toBe(2);
    expect(detail.bottomInset).toBe(24);
    expect(windowLayout(window(390, 844), insets, false).bottomInset).toBe(24);
  });

  it("reduces columns when larger text needs more room", () => {
    const normal = windowLayout(window(1024, 768), noInsets);
    const enlarged = windowLayout(window(1024, 768, 1.6), noInsets);
    expect(normal.columns).toBe(3);
    expect(enlarged.columns).toBe(1);
    expect(normal.detailColumns).toBe(2);
    expect(enlarged.detailColumns).toBe(1);
  });

  it("keeps sheets bounded and removes extra bottom spacing in short landscape windows", () => {
    const portrait = windowLayout(window(768, 1024), { ...noInsets, top: 24, bottom: 20 });
    const landscape = windowLayout(window(844, 390), { top: 0, left: 59, right: 59, bottom: 21 });
    expect(portrait.sheetWidth).toBe(640);
    expect(portrait.sheetGap).toBe(16);
    expect(landscape.sheetWidth).toBeLessThanOrEqual(landscape.usableWidth);
    expect(landscape.sheetGap).toBe(0);
    expect(landscape.usableHeight).toBe(369);
  });

  it("keeps content, columns, and sheets inside the safe window across window sizes", () => {
    for (const width of [320, 375, 600, 719, 720, 768, 834, 1024, 1366, 2560]) {
      for (const height of [320, 600, 1024]) {
        for (const fontScale of [1, 1.3, 2]) {
          const layout = windowLayout(window(width, height, fontScale), { top: 24, left: 30, right: 10, bottom: 20 });
          expect(layout.contentWidth + 2 * layout.gutter + layout.railWidth).toBeLessThanOrEqual(width - 40);
          expect(layout.sheetWidth + 2 * layout.sheetGap).toBeLessThanOrEqual(width - 40);
          if (layout.columns > 1) {
            expect((layout.contentWidth - 16 * (layout.columns - 1)) / layout.columns).toBeGreaterThanOrEqual(280 * fontScale);
          }
        }
      }
    }
  });
});

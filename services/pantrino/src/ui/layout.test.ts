import { describe, expect, it } from "vitest";
import { paneWidths, windowLayout } from "./layout";

const noInsets = { top: 0, left: 0, right: 0, bottom: 0 };
const window = (width: number, height = 844, fontScale = 1) => ({ width, height, fontScale });

describe("Pantrino's available window", () => {
  it.each([
    [320, "compact", "bottom", 1],
    [360, "compact", "bottom", 1],
    [599, "compact", "bottom", 1],
    [600, "medium", "rail", 2],
    [690, "medium", "rail", 2],
    [839, "medium", "rail", 2],
    [840, "expanded", "rail", 3],
    [1180, "expanded", "rail", 3],
  ] as const)("shows the right navigation and panes at %i dp", (width, windowClass, navigation, panes) => {
    expect(windowLayout(window(width), noInsets)).toMatchObject({ windowClass, navigation, panes });
  });

  it("keeps the rail and two panes in an 800 by 400 landscape window", () => {
    expect(windowLayout(window(800, 400), noInsets)).toMatchObject({ navigation: "rail", windowClass: "medium", panes: 2, sheetGap: 0 });
  });

  it("chooses its class from usable width after horizontal safe areas", () => {
    const layout = windowLayout(window(690), { ...noInsets, left: 48, right: 48 });
    expect(layout).toMatchObject({ usableWidth: 594, windowClass: "compact", navigation: "bottom", panes: 1 });
  });

  it("splits the space after the rail evenly so the list pane can hold a header on a foldable", () => {
    for (const width of [600, 690, 800, 840, 1180]) {
      const layout = windowLayout(window(width), noInsets);
      const [left, right] = paneWidths(layout);
      expect(left).toBe(right);
      expect(left + right + layout.railWidth).toBe(width);
      expect(left).toBeGreaterThanOrEqual(260);
    }
  });

  it("returns to the same phone layout after folding and rotating", () => {
    const layouts = [360, 690, 1180, 360].map((width) => windowLayout(window(width), noInsets));
    expect(layouts.map((one) => one.panes)).toEqual([1, 2, 3, 1]);
    expect(layouts[0]).toEqual(layouts[3]);
  });

  it("keeps window classes stable with 160 percent text so the same open panes can reflow", () => {
    for (const width of [320, 360, 600, 690, 840, 1180]) {
      expect(windowLayout(window(width, 844, 1.6), noInsets)).toEqual(windowLayout(window(width), noInsets));
    }
  });

  it("gives standalone screens the rail's space and protects their bottom controls", () => {
    const insets = { ...noInsets, bottom: 24 };
    const tab = windowLayout(window(690), insets);
    const detail = windowLayout(window(690), insets, false);
    expect(detail.contentWidth - tab.contentWidth).toBe(tab.railWidth);
    expect(detail.railWidth).toBe(0);
    expect(detail.bottomInset).toBe(24);
    expect(windowLayout(window(360), insets).bottomInset).toBe(0);
  });

  it("keeps content and sheets inside the safe window at every size", () => {
    for (const width of [320, 360, 600, 690, 840, 1180, 2560]) {
      for (const height of [400, 844]) {
        const layout = windowLayout(window(width, height), { top: 24, left: 30, right: 10, bottom: 20 });
        expect(layout.contentWidth + 2 * layout.gutter + layout.railWidth).toBeLessThanOrEqual(width - 40);
        expect(layout.sheetWidth + 2 * layout.sheetGap).toBeLessThanOrEqual(width - 40);
        expect(layout.contentWidth).toBeLessThanOrEqual(layout.panes * 720 + (layout.panes - 1) * 32);
      }
    }
    expect(windowLayout(window(690), noInsets).sheetGap).toBe(16);
  });
});

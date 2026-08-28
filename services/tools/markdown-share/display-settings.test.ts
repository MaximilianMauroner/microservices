import { describe, expect, it } from "vitest";
import {
  DEFAULT_DISPLAY_SETTINGS,
  parseDisplaySettings,
} from "./display-settings.js";

describe("display settings", () => {
  it("uses defaults for missing or malformed settings", () => {
    expect(parseDisplaySettings(null)).toEqual(DEFAULT_DISPLAY_SETTINGS);
    expect(parseDisplaySettings("not-json")).toEqual(DEFAULT_DISPLAY_SETTINGS);
  });

  it("restores valid stored settings", () => {
    expect(
      parseDisplaySettings(JSON.stringify({ fontScale: 1.2, lineSpacing: 1.9 })),
    ).toEqual({ fontScale: 1.2, lineSpacing: 1.9 });
  });

  it("clamps stored values to the supported range", () => {
    expect(
      parseDisplaySettings(JSON.stringify({ fontScale: 10, lineSpacing: 0 })),
    ).toEqual({ fontScale: 1.4, lineSpacing: 0.8 });
  });
});

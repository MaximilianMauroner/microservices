import { describe, expect, it, vi } from "vitest";

vi.mock("expo-haptics", () => ({ selectionAsync: vi.fn(), impactAsync: vi.fn(), ImpactFeedbackStyle: {}, AndroidHaptics: {}, performAndroidHapticsAsync: vi.fn() }));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
const { parseStrength, step } = await import("./haptics");

const FEELS = ["tap", "toggle", "threshold", "firm", "hold", "warn"] as const;

describe("haptics", () => {
  it("does not vibrate when vibration is off", () => {
    for (const feel of FEELS) expect(step(feel, "off")).toBeNull();
  });

  it("vibrates each press at least as firm at strong as at light", () => {
    for (const feel of FEELS) expect(step(feel, "strong")!).toBeGreaterThanOrEqual(step(feel, "light")!);
    expect(step("tap", "strong")).toBeGreaterThan(step("tap", "light")!);
  });

  it("taps softer than it warns", () => {
    expect(step("tap", "light")!).toBeLessThan(step("warn", "light")!);
  });

  it("falls back to light for a missing or unknown saved strength", () => {
    expect(parseStrength(null)).toBe("light");
    expect(parseStrength("loud")).toBe("light");
    expect(parseStrength("strong")).toBe("strong");
  });
});

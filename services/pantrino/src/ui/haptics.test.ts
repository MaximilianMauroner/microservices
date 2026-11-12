import { beforeEach, describe, expect, it, vi } from "vitest";

const performAndroidHapticsAsync = vi.fn(async () => undefined);
vi.mock("expo-haptics", () => ({ impactAsync: vi.fn(), ImpactFeedbackStyle: {}, AndroidHaptics: { Virtual_Key: "click", Long_Press: "heavy" }, performAndroidHapticsAsync }));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
const { haptic, parseVibration, setVibration } = await import("./haptics");

describe("haptics", () => {
  beforeEach(() => performAndroidHapticsAsync.mockClear());

  it("does not vibrate when vibration is off", () => {
    setVibration("off");
    haptic("tap");
    haptic("warn");
    expect(performAndroidHapticsAsync).not.toHaveBeenCalled();
  });

  it("vibrates once per press when it is on, firmer for a warning than for a tap", () => {
    setVibration("on");
    haptic("tap");
    haptic("warn");
    expect(performAndroidHapticsAsync.mock.calls).toEqual([["click"], ["heavy"]]);
  });

  it("keeps vibration on for a saved light or strong strength and for no saved choice", () => {
    expect(parseVibration(null)).toBe("on");
    expect(parseVibration("light")).toBe("on");
    expect(parseVibration("strong")).toBe("on");
    expect(parseVibration("off")).toBe("off");
  });
});

import * as Haptics from "expo-haptics";
import { createContext, useContext } from "react";
import { Platform } from "react-native";

/** What a press means, which sets how firm its vibration is. */
export type Feel = "tap" | "toggle" | "threshold" | "firm" | "hold" | "warn";

export const STRENGTHS = ["off", "light", "strong"] as const;
export type Strength = (typeof STRENGTHS)[number];

/**
 * Vibrations from softest to firmest. Android uses its touch effects, which the phone maker tunes and which follow the
 * phone's touch vibration setting. Only the tick, the click, and the heavy click play on every phone (the softer ticks
 * need vibration primitives), so the middle two steps share the click. Its plain vibrations are weaker than these.
 */
const STEPS: readonly (() => Promise<void>)[] = Platform.OS === "android"
  ? [Haptics.AndroidHaptics.Segment_Tick, Haptics.AndroidHaptics.Virtual_Key, Haptics.AndroidHaptics.Virtual_Key, Haptics.AndroidHaptics.Long_Press]
    .map((type) => () => Haptics.performAndroidHapticsAsync(type))
  : [
    () => Haptics.selectionAsync(),
    () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
    () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
    () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  ];

/** The step of each feel at the light strength. A plain tap is the softest, so a screen full of taps does not tire the hand. */
const BASE: Record<Feel, number> = { tap: 0, toggle: 1, threshold: 1, firm: 1, hold: 2, warn: 2 };

/** How many steps each strength adds. Off has none. */
const LIFT: Record<Strength, number | null> = { off: null, light: 0, strong: 1 };

let strength: Strength = "light";

export function parseStrength(saved: string | null): Strength {
  return STRENGTHS.find((one) => one === saved) ?? "light";
}

export function setStrength(next: Strength) {
  strength = next;
}

/** The step a feel vibrates with at a strength, or null for none. */
export function step(feel: Feel, at: Strength): number | null {
  const lift = LIFT[at];
  return lift === null ? null : Math.min(BASE[feel] + lift, STEPS.length - 1);
}

export function haptic(feel: Feel) {
  const index = step(feel, strength);
  if (index !== null) void STEPS[index]!().catch(() => undefined);
}

export const HapticsContext = createContext<{ strength: Strength; setStrength: (strength: Strength) => void }>({ strength: "light", setStrength: () => undefined });

export function useHaptics() {
  return useContext(HapticsContext);
}

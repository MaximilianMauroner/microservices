import * as Haptics from "expo-haptics";
import { createContext, useContext } from "react";
import { Platform } from "react-native";

/** What a press or a swipe means, which sets how firm its vibration is. */
export type Feel = "tap" | "toggle" | "threshold" | "firm" | "hold" | "warn";

export const VIBRATION = ["off", "on"] as const;
export type Vibration = (typeof VIBRATION)[number];

const android = (type: Haptics.AndroidHaptics) => () => Haptics.performAndroidHapticsAsync(type);
const impact = (style: Haptics.ImpactFeedbackStyle) => () => Haptics.impactAsync(style);

/**
 * Android uses its touch effects, which the phone maker tunes and which follow the phone's touch vibration setting.
 * The click and the heavy click play on every phone. A hold and a warning are firmer than a tap.
 */
const EFFECTS: Record<Feel, () => Promise<void>> = Platform.OS === "android"
  ? {
    tap: android(Haptics.AndroidHaptics.Virtual_Key), toggle: android(Haptics.AndroidHaptics.Virtual_Key), threshold: android(Haptics.AndroidHaptics.Virtual_Key),
    firm: android(Haptics.AndroidHaptics.Virtual_Key), hold: android(Haptics.AndroidHaptics.Long_Press), warn: android(Haptics.AndroidHaptics.Long_Press),
  }
  : {
    tap: impact(Haptics.ImpactFeedbackStyle.Light), toggle: impact(Haptics.ImpactFeedbackStyle.Medium), threshold: impact(Haptics.ImpactFeedbackStyle.Medium),
    firm: impact(Haptics.ImpactFeedbackStyle.Medium), hold: impact(Haptics.ImpactFeedbackStyle.Heavy), warn: impact(Haptics.ImpactFeedbackStyle.Heavy),
  };

let vibration: Vibration = "on";

/** Earlier versions saved a strength. Light and Strong both mean on. */
export function parseVibration(saved: string | null): Vibration {
  return saved === "off" ? "off" : "on";
}

export function setVibration(next: Vibration) {
  vibration = next;
}

export function haptic(feel: Feel) {
  if (vibration === "on") void EFFECTS[feel]().catch(() => undefined);
}

export const HapticsContext = createContext<{ vibration: Vibration; setVibration: (vibration: Vibration) => void }>({ vibration: "on", setVibration: () => undefined });

export function useHaptics() {
  return useContext(HapticsContext);
}

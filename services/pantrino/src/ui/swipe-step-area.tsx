import type { ReactNode } from "react";
import { View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import { scheduleOnRN } from "react-native-worklets";
import { haptic } from "./haptics";
import { swipeStep } from "./swipe-step";

export function SwipeStepArea({ children, onStep }: { children: ReactNode; onStep: (step: -1 | 1) => boolean }) {
  const finish = (translation: number, velocity: number) => {
    const step = swipeStep(translation, velocity);
    if (step && onStep(step)) haptic("toggle");
  };
  const swipe = usePanGesture({
    activeOffsetX: [-18, 18],
    failOffsetY: [-12, 12],
    hitSlop: { left: -12, right: -12 },
    onDeactivate: (event) => {
      if (!event.canceled) scheduleOnRN(finish, event.translationX, event.velocityX);
    },
  });
  return <GestureDetector gesture={swipe}><View collapsable={false}>{children}</View></GestureDetector>;
}

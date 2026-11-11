import { InstrumentSans_400Regular, InstrumentSans_500Medium, InstrumentSans_600SemiBold, InstrumentSans_700Bold, useFonts } from "@expo-google-fonts/instrument-sans";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppProvider, useApp } from "../state";
import { useColors } from "../ui/theme";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fonts] = useFonts({ InstrumentSans_400Regular, InstrumentSans_500Medium, InstrumentSans_600SemiBold, InstrumentSans_700Bold });
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppProvider>{fonts ? <Gate /> : null}</AppProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** Both account and local kitchens open through the same tab routes. */
function Gate() {
  const { session } = useApp();
  const colors = useColors();
  useEffect(() => {
    if (session !== "loading") void SplashScreen.hideAsync();
  }, [session]);
  if (session === "loading") return null;
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Protected guard={(session === "signed-in" || session === "local")}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="search" />
          <Stack.Screen name="bodyshop" />
        </Stack.Protected>
        <Stack.Protected guard={session === "signed-out"}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

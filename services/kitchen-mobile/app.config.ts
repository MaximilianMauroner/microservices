import type { ExpoConfig } from "expo/config";

/** The Tools server this build talks to. Each EAS build profile sets it, so a development build never reaches production data. */
const toolsOrigin = process.env.TOOLS_ORIGIN;
if (!toolsOrigin) throw new Error("Set TOOLS_ORIGIN to the Tools server for this build.");

const config: ExpoConfig = {
  name: "Kitchen",
  slug: "kitchen",
  scheme: "com.lab4code.kitchen",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  ios: { bundleIdentifier: "com.lab4code.kitchen", supportsTablet: false },
  android: {
    package: "com.lab4code.kitchen",
    allowBackup: false,
    adaptiveIcon: {
      backgroundColor: "#000000",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png"
    }
  },
  plugins: [
    "expo-router",
    ["expo-sqlite", { useSQLCipher: true }],
    "expo-secure-store",
    "expo-web-browser",
    "expo-font"
  ],
  experiments: { typedRoutes: true },
  extra: { toolsOrigin }
};

export default config;

import type { ExpoConfig } from "expo/config";

/** The Tools server this build talks to. Each EAS build profile sets it, so a development build never reaches production data. */
const toolsOrigin = process.env.TOOLS_ORIGIN;
if (!toolsOrigin) throw new Error("Set TOOLS_ORIGIN to the Tools server for this build.");

const config: ExpoConfig = {
  name: "Pantrino",
  slug: "pantrino",
  scheme: "com.lab4code.pantrino",
  version: "1.0.0",
  orientation: "default",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  ios: { bundleIdentifier: "com.lab4code.pantrino", supportsTablet: true, config: { usesNonExemptEncryption: false } },
  android: {
    package: "com.lab4code.pantrino",
    allowBackup: false,
    adaptiveIcon: {
      backgroundColor: "#11877C",
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
  owner: "thearizztokrat",
  extra: { toolsOrigin, eas: { projectId: "4553acd7-e463-4e83-845d-287fd515b542" } }
};

export default config;

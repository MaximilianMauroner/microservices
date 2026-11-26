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
    permissions: [
      "READ_WEIGHT", "WRITE_NUTRITION", "READ_STEPS", "READ_SLEEP", "READ_HEALTH_DATA_HISTORY",
      "READ_ACTIVE_CALORIES_BURNED", "READ_DISTANCE", "READ_ELEVATION_GAINED", "READ_EXERCISE",
      "READ_FLOORS_CLIMBED", "READ_SPEED", "READ_TOTAL_CALORIES_BURNED", "READ_BODY_FAT",
      "READ_HEART_RATE", "READ_RESTING_HEART_RATE",
    ].map((permission) => `android.permission.health.${permission}`),
    adaptiveIcon: {
      backgroundColor: "#11877C",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png"
    }
  },
  plugins: [
    "expo-router",
    "./plugins/health-connect-rationale.cjs",
    "react-native-health-connect",
    ["expo-sqlite", { useSQLCipher: true }],
    "expo-secure-store",
    "expo-web-browser",
    "expo-font",
    ["expo-camera", { cameraPermission: "Pantrino reads the barcode on a food package to fill in its nutrition.", microphonePermission: false, recordAudioAndroid: false }]
  ],
  experiments: { typedRoutes: true },
  owner: "thearizztokrat",
  extra: { toolsOrigin, eas: { projectId: "4553acd7-e463-4e83-845d-287fd515b542" } }
};

export default config;

import { useSyncExternalStore } from "react";
import { HeartPulse, Scale, Footprints, Moon, Utensils, ChevronRight } from "lucide-react-native";
import { Alert, Linking, StyleSheet, Switch, View } from "react-native";
import { healthSync } from "../../health/sync";
import type { HealthFeature } from "../../health/contract";
import { Button, Press, T } from "../kit";
import { LOCALES, useLanguage, useText } from "../language";
import privacy from "../../../assets/health-connect-privacy.json";
import { tint, useColors } from "../theme";

const TEXT = {
  en: {
    weight: "Weight",
    steps: "Steps",
    sleep: "Sleep",
    nutrition: "Nutrition",
    incoming: "Import to Bodyshop",
    outgoing: "Share with Health Connect",
    details: { weight: "Measurements from scales and health apps", steps: "Daily totals for your check-ins", sleep: "Sleep duration for your check-ins", nutrition: "New food entries, calories, and nutrients" },
    needsAccess: "Access required",
    connected: "Connected",
    available: "Ready to connect",
    unavailable: "Health Connect is unavailable on this device.",
    "update-required": "Install or update Health Connect to continue.",
    syncing: "Syncing…",
    "server-update-required": "Tools needs an update before it can import steps or sleep.",
    failed: "Sync could not finish. Check your connection and try again.",
    "permission-required": "Health Connect permission is missing. Allow access to resume syncing.",
    idle: "",
    enable: "Enable",
    allow: "Allow access",
    cancel: "Cancel",
    sync: "Sync now",
    history: "Import older steps and sleep",
    historyDetail: "Allow up to 90 days of available steps and sleep to be saved in Bodyshop.",
    manage: "Manage permissions",
    update: "Open Google Play",
    disconnect: "Disconnect",
    privacy: "Privacy policy",
    last: (time: string) => `Last successful sync · ${time}`,
    weightConsent: "Pantrino will read weight measurements from Health Connect and store them in your Bodyshop account. You can stop future imports here. To delete imported readings, remove them in Bodyshop.",
    stepsConsent: "Pantrino reads daily step totals from the past seven completed days to fill empty Bodyshop check-ins. It stores the totals in your Bodyshop account.",
    sleepConsent: "Pantrino reads completed sleep sessions from today and the past six days. It stores the total hours per wake date in empty Bodyshop check-ins.",
    nutritionConsent: "Pantrino will share new Bodyshop food entries with Health Connect, including the food name, meal, calories, and nutrients. Existing entries will stay private.",
    disconnectBody: "Pantrino will stop syncing. Imported readings and check-in values stay in Bodyshop. Exported food entries stay in Health Connect until you delete them there.",
  },
  de: {
    weight: "Gewicht",
    steps: "Schritte",
    sleep: "Schlaf",
    nutrition: "Ernährung",
    incoming: "In Bodyshop importieren",
    outgoing: "Mit Health Connect teilen",
    details: { weight: "Messungen von Waagen und Gesundheits-Apps", steps: "Tagessummen für deine Tageswerte", sleep: "Schlafdauer für deine Tageswerte", nutrition: "Neue Ernährungseinträge mit Kalorien und Nährwerten" },
    needsAccess: "Zugriff erforderlich",
    connected: "Verbunden",
    available: "Bereit zum Verbinden",
    unavailable: "Health Connect ist auf diesem Gerät nicht verfügbar.",
    "update-required": "Installiere oder aktualisiere Health Connect, um fortzufahren.",
    syncing: "Wird synchronisiert…",
    "server-update-required": "Tools braucht ein Update, bevor es Schritte oder Schlaf importieren kann.",
    failed: "Die Synchronisierung ist fehlgeschlagen. Prüfe die Verbindung und versuche es erneut.",
    "permission-required": "Eine Berechtigung für Health Connect fehlt. Erlaube den Zugriff, um weiter zu synchronisieren.",
    idle: "",
    enable: "Aktivieren",
    allow: "Zugriff erlauben",
    cancel: "Abbrechen",
    sync: "Jetzt synchronisieren",
    history: "Ältere Schritte und Schlafdaten importieren",
    historyDetail: "Speichere bis zu 90 Tage verfügbarer Schritt- und Schlafdaten in Bodyshop.",
    manage: "Berechtigungen verwalten",
    update: "Google Play öffnen",
    disconnect: "Verbindung trennen",
    privacy: "Datenschutzerklärung",
    last: (time: string) => `Letzte erfolgreiche Synchronisierung · ${time}`,
    weightConsent: "Pantrino liest Gewichtsmessungen aus Health Connect und speichert sie in deinem Bodyshop-Konto. Du kannst weitere Importe hier stoppen. Importierte Messungen kannst du in Bodyshop löschen.",
    stepsConsent: "Pantrino liest die Schrittzahlen der letzten sieben abgeschlossenen Tage und trägt sie in leere Felder in deinem Bodyshop-Konto ein.",
    sleepConsent: "Pantrino liest abgeschlossene Schlafsitzungen von heute und den letzten sechs Tagen. Es trägt die Schlafdauer pro Aufwachdatum in leere Felder in deinem Bodyshop-Konto ein.",
    nutritionConsent: "Pantrino teilt neue Ernährungseinträge aus Bodyshop mit Health Connect. Dazu gehören Lebensmittel, Mahlzeit, Kalorien und Nährwerte. Vorhandene Einträge bleiben privat.",
    disconnectBody: "Pantrino beendet die Synchronisierung. Importierte Messungen und Tageswerte bleiben in Bodyshop. Exportierte Einträge bleiben in Health Connect, bis du sie dort löschst.",
  },
};

const GROUPS = [
  { title: "incoming", features: ["weight", "steps", "sleep"] },
  { title: "outgoing", features: ["nutrition"] },
] as const;

const ICONS = { weight: Scale, steps: Footprints, sleep: Moon, nutrition: Utensils };

export function HealthSettings() {
  const { availability, permissions, preferences, status } = useSyncExternalStore(healthSync.subscribe, healthSync.snapshot);
  const text = useText(TEXT);
  const colors = useColors();
  const language = useLanguage();
  const features = GROUPS.flatMap(({ features }) => [...features]);
  const enabled = features.some((feature) => preferences[feature]);
  const needsAccess = features.some((feature) => preferences[feature] && !permissions.includes(feature));
  const available = availability === "available";
  const statusText = available && enabled ? text[needsAccess ? "needsAccess" : "connected"] : text[availability];

  function toggle(feature: HealthFeature, next: boolean) {
    if (!next) return void healthSync.setEnabled(feature, false);
    Alert.alert(text[feature], text[`${feature}Consent`], [
      { text: text.cancel, style: "cancel" },
      { text: text.enable, onPress: () => void healthSync.setEnabled(feature, true) },
    ]);
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={[styles.row, { minHeight: 0 }]}>
          <View style={[styles.icon, { backgroundColor: tint(colors.page.kitchen, 12, colors.card) }]}>
            <HeartPulse size={22} color={colors.pageInk.kitchen} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <T accessibilityRole="header" weight="semibold" style={{ fontSize: 19 }}>Health Connect</T>
            <T muted style={{ color: available && enabled ? needsAccess ? colors.warning : colors.positive : colors.mutedForeground }}>
              {statusText}
            </T>
          </View>
        </View>
        {preferences.lastSync ? <T muted style={styles.detail}>{text.last(new Date(preferences.lastSync).toLocaleString(LOCALES[language]))}</T> : null}
        {available && text[status] ? <T accessibilityLiveRegion="polite" style={styles.detail}>{text[status]}</T> : null}
        {available && enabled ? <Button tone="outline" label={text.sync} disabled={status === "syncing"} onPress={() => void healthSync.sync()} /> : null}
        {availability === "update-required" ? <Button tone="outline" label={text.update} onPress={() => {
          void Linking.openURL("https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata").catch(() => undefined);
        }} /> : null}
      </View>

      {available ? GROUPS.map(({ title, features }) => (
        <View key={title} style={[styles.group, { borderBottomColor: colors.border }]}>
          <T accessibilityRole="header" weight="semibold" muted style={styles.detail}>{text[title]}</T>
          {features.map((feature) => {
            const Icon = ICONS[feature];
            const checked = Boolean(preferences[feature]);
            return (
              <View key={feature}>
                <View style={styles.row}>
                  <Icon size={20} color={colors.mutedForeground} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <T weight="medium">{text[feature]}</T>
                    <T muted style={styles.detail}>{text.details[feature]}</T>
                  </View>
                  <Switch accessibilityLabel={text[feature]} accessibilityHint={text.details[feature]} value={checked}
                    onValueChange={(next) => toggle(feature, next)} trackColor={{ true: colors.page.kitchen }} thumbColor={checked ? "#fff" : undefined} />
                </View>
                {checked && !permissions.includes(feature) ? (
                  <Press accessibilityRole="button" accessibilityLabel={`${text.allow} · ${text[feature]}`} onPress={() => void healthSync.setEnabled(feature, true)} style={styles.repair}>
                    <T weight="medium" style={{ color: colors.warning }}>{text.allow}</T>
                  </Press>
                ) : null}
              </View>
            );
          })}
        </View>
      )) : null}

      <View style={[styles.group, { borderBottomWidth: 0 }]}>
        {available && (preferences.sleep || preferences.steps) ? <View style={styles.row}>
          <View style={{ flex: 1, gap: 2 }}>
            <T weight="medium">{text.history}</T>
            <T muted style={styles.detail}>{text.historyDetail}</T>
          </View>
          <Switch accessibilityLabel={text.history} accessibilityHint={text.historyDetail}
            value={Boolean(preferences.extendedHistory)}
            onValueChange={(next) => void healthSync.setExtendedHistory(next)} />
        </View> : null}
        {available ? <ConnectionAction label={text.manage} onPress={healthSync.openSettings} /> : null}
        <ConnectionAction label={text.privacy} onPress={() => Alert.alert(privacy[language].title, privacy[language].body)} />
        {enabled ? <ConnectionAction label={text.disconnect} destructive onPress={() => Alert.alert(text.disconnect, text.disconnectBody, [
          { text: text.cancel, style: "cancel" },
          { text: text.disconnect, style: "destructive", onPress: () => void healthSync.disconnect() },
        ])} /> : null}
      </View>
    </View>
  );
}

function ConnectionAction({ label, onPress, destructive = false }: { label: string; onPress: () => void; destructive?: boolean }) {
  const colors = useColors();
  return (
    <Press accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, { minHeight: 48, opacity: pressed ? 0.7 : 1 }]}>
      <T weight="medium" style={{ flex: 1, color: destructive ? colors.destructive : colors.foreground }}>{label}</T>
      <ChevronRight size={16} color={colors.mutedForeground} />
    </Press>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16 },
  header: { padding: 16, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  icon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  group: { paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 60, paddingVertical: 6 },
  repair: { minHeight: 44, marginLeft: 32, justifyContent: "center", alignSelf: "flex-start" },
  detail: { fontSize: 13 },
});

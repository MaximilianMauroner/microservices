import { router, useFocusEffect } from "expo-router";
import { CheckCircle2, Circle } from "lucide-react-native";
import { useCallback, useRef, useState } from "react";
import { AppState, Linking, Platform, StyleSheet, View } from "react-native";
import type { Availability } from "../../health/contract";
import { DEVICE_METRIC_GROUPS, type DeviceMetric } from "../../health/device-metrics";
import { deviceMetricsAvailability, grantedDeviceMetrics, openDeviceMetricsSettings, requestDeviceMetrics } from "../../health/device-metrics-reader";
import { useApp, useBodyshop } from "../../state";
import { Button, Screen, T, useKitText } from "../kit";
import { useText } from "../language";
import { useColors } from "../theme";
import { HEALTH_METRICS_TEXT } from "./health-metrics-text";

type PermissionView = { kind: "loading" | "failed" | Exclude<Availability, "available"> }
  | { kind: "available"; granted: readonly DeviceMetric[] };

export function HealthMetricsSettings() {
  const { session } = useApp();
  const { access } = useBodyshop();
  const text = useText(HEALTH_METRICS_TEXT);
  const kit = useKitText();
  const available = Platform.OS === "android" && session === "signed-in" && access !== "none";

  return (
    <Screen title={text.title} back={{ label: kit.back, onPress: () => router.canGoBack() ? router.back() : router.replace("/settings") }}>
      {available ? <Permissions /> : <T muted>{text.unavailable}</T>}
    </Screen>
  );
}

function Permissions() {
  const text = useText(HEALTH_METRICS_TEXT);
  const colors = useColors();
  const [view, setView] = useState<PermissionView>({ kind: "loading" });
  const [requesting, setRequesting] = useState(false);
  const [requestFailed, setRequestFailed] = useState(false);
  const refreshRef = useRef<(() => Promise<void>) | null>(null);

  useFocusEffect(useCallback(() => {
    let active = true;
    let version = 0;
    async function refresh() {
      const read = ++version;
      try {
        const availability = await deviceMetricsAvailability();
        const next: PermissionView = availability === "available"
          ? { kind: "available", granted: await grantedDeviceMetrics() }
          : { kind: availability };
        if (active && read === version) setView(next);
      } catch {
        if (active && read === version) setView({ kind: "failed" });
      }
    }
    refreshRef.current = refresh;
    void refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
      else version++;
    });
    return () => { active = false; refreshRef.current = null; subscription.remove(); };
  }, []));

  async function allow(metrics: readonly DeviceMetric[]) {
    setRequesting(true);
    setRequestFailed(false);
    try {
      await requestDeviceMetrics(metrics);
    } catch {
      setRequestFailed(true);
    } finally {
      setRequesting(false);
      await refreshRef.current?.();
    }
  }

  return (
    <>
      <T muted>{text.readOnly}</T>
      {view.kind === "available" ? <>
        {(Object.keys(DEVICE_METRIC_GROUPS) as (keyof typeof DEVICE_METRIC_GROUPS)[]).map((group) => {
          const metrics = DEVICE_METRIC_GROUPS[group];
          const missing = metrics.filter((metric) => !view.granted.includes(metric));
          return (
            <View key={group} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <T accessibilityRole="header" weight="semibold" style={{ fontSize: 18 }}>{text[group]}</T>
              {metrics.map((metric) => {
                const allowed = view.granted.includes(metric);
                const Icon = allowed ? CheckCircle2 : Circle;
                return (
                  <View key={metric} style={[styles.row, { borderTopColor: colors.border }]}>
                    <Icon size={17} color={allowed ? colors.positive : colors.mutedForeground} />
                    <T style={{ flex: 1 }}>{text.metric[metric]}</T>
                    <T muted style={{ fontSize: 13 }}>{allowed ? text.granted : text.denied}</T>
                  </View>
                );
              })}
              {missing.length ? <Button label={text.allow} accessibilityLabel={`${text.allow} · ${text[group]}`}
                tone="outline" disabled={requesting} onPress={() => void allow(missing)} /> : null}
            </View>
          );
        })}
        {requestFailed ? <T accessibilityLiveRegion="polite" muted>{text.permissionRequestFailed}</T> : null}
        <Button label={text.settings} tone="outline" disabled={requesting} onPress={openDeviceMetricsSettings} />
      </> : <>
        <T muted accessibilityLiveRegion="polite">{view.kind === "update-required" ? text.update : view.kind === "failed" ? text.permissionCheckFailed : text[view.kind]}</T>
        {view.kind === "failed" ? <Button label={text.retry} tone="outline" onPress={() => void refreshRef.current?.()} /> : null}
        {view.kind === "update-required" ? <Button label={text.updateAction} tone="outline" onPress={() => {
          void Linking.openURL("https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata").catch(() => undefined);
        }} /> : null}
      </>}
    </>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, gap: 6, borderWidth: 1, borderRadius: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
});

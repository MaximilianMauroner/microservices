import { HEALTH_METRICS_TEXT as COPY } from "./health-metrics-text";
import { useIsFocused } from "expo-router";
import { Activity, ChevronDown, ChevronLeft, ChevronRight, HeartPulse } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { AppState, Linking, Platform, StyleSheet, View } from "react-native";
import { deviceMetricDays, DEVICE_METRIC_GROUPS as GROUPS, readDeviceMetricHistory, type DeviceMetric, type DeviceMetricPoint } from "../../health/device-metrics";
import { deviceMetricGranted, deviceMetricsAvailability, openDeviceMetricsSettings, readDeviceMetric, requestDeviceMetrics } from "../../health/device-metrics-reader";
import { Button, dayParts, Press, Sheet, T } from "../kit";
import { LOCALES, useLanguage, useText } from "../language";
import { DayPlot } from "./day-plot";
import { tint, useColors } from "../theme";

const LEVELS = new Set<DeviceMetric>(["speed", "bodyFat", "heartRate", "restingHeartRate"]);
const UNITS: Record<DeviceMetric, string> = {
  activeCalories: "kcal", distance: "km", elevation: "m", exercise: "min", floors: "", speed: "km/h",
  totalCalories: "kcal", bodyFat: "%", heartRate: "bpm", restingHeartRate: "bpm",
};

export function HealthMetrics({ range }: { range: 7 | 30 }) {
  const text = useText(COPY);
  const colors = useColors();
  const [choosing, setChoosing] = useState(false);
  const [group, setGroup] = useState<keyof typeof GROUPS>("activity");
  const [picks, setPicks] = useState<{ [Key in keyof typeof GROUPS]: DeviceMetric }>({ activity: "activeCalories", measurements: "restingHeartRate" });
  const metric = picks[group];
  const focused = useIsFocused();
  if (Platform.OS !== "android" || !focused) return null;

  const Icon = group === "activity" ? Activity : HeartPulse;
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.heading}>
        <View style={[styles.icon, { backgroundColor: tint(colors.pageInk.insights, 16, colors.card) }]}>
          <Icon size={20} color={colors.pageInk.insights} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <T accessibilityRole="header" weight="semibold" style={{ fontSize: 18 }}>{text.title}</T>
          <T muted style={styles.small}>{text.intro}</T>
        </View>
      </View>
      <View accessibilityRole="radiogroup" style={styles.options}>
        {(Object.keys(GROUPS) as (keyof typeof GROUPS)[]).map((key) =>
          <MetricOption key={key} label={text[key]} selected={key === group} onPress={() => { setGroup(key); setChoosing(false); }} />)}
      </View>
      <Press accessibilityRole="button" accessibilityLabel={`${text.choose}. ${text.metric[metric]}`} onPress={() => setChoosing(true)}
        style={[styles.heading, styles.selector, { borderColor: colors.border }]}>
        <T weight="medium" style={{ flex: 1 }}>{text.metric[metric]}</T>
        <ChevronDown size={18} color={colors.mutedForeground} />
      </Press>
      <MetricHistory key={`${metric}-${range}`} metric={metric} range={range} group={GROUPS[group]} />
      {choosing ? <Sheet open title={text.choose} onClose={() => setChoosing(false)}>
        {GROUPS[group].map((key) => <MetricOption key={key} label={text.metric[key]} selected={key === metric} onPress={() => {
          setPicks((one) => ({ ...one, [group]: key }));
          setChoosing(false);
        }} />)}
      </Sheet> : null}
    </View>
  );
}

function MetricOption({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <Press accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress}
      style={[styles.option, { backgroundColor: selected ? tint(colors.pageInk.insights, 20, colors.card) : colors.muted }]}>
      <T weight={selected ? "semibold" : "regular"}>{label}</T>
    </Press>
  );
}

type State = { kind: "loading" | "permission" | "failed" | "unavailable" | "update-required" } | { kind: "ready"; points: DeviceMetricPoint[] };

function MetricHistory({ metric, range, group }: { metric: DeviceMetric; range: number; group: readonly DeviceMetric[] }) {
  const text = useText(COPY);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [settings, setSettings] = useState(false);
  const requesting = useRef(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const availability = await deviceMetricsAvailability();
        if (!active) return;
        if (availability !== "available") { setState({ kind: availability }); return; }
        const granted = await deviceMetricGranted(metric);
        if (!active) return;
        if (!granted) { setState({ kind: "permission" }); return; }
        const points = await readDeviceMetricHistory(
          deviceMetricDays(Date.now(), range), (day) => readDeviceMetric(metric, day, () => active), () => active,
        );
        if (!points || !active) return;
        const stillGranted = await deviceMetricGranted(metric);
        if (active) setState(stillGranted ? { kind: "ready", points } : { kind: "permission" });
      } catch {
        if (active) setState({ kind: "failed" });
      }
    }
    let backgrounded = AppState.currentState === "background";
    if (!backgrounded) void load();
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "background") {
        active = false;
        backgrounded = true;
        if (!requesting.current) setState({ kind: "loading" });
      } else if (next === "active" && backgrounded && !requesting.current) {
        backgrounded = false;
        setAttempt((n) => n + 1);
      }
    });
    return () => { active = false; subscription.remove(); };
  }, [metric, range, attempt]);

  async function allow() {
    requesting.current = true;
    setState({ kind: "loading" });
    try {
      await requestDeviceMetrics(group);
      const granted = await deviceMetricGranted(metric);
      setSettings(!granted);
      if (granted) setAttempt((n) => n + 1);
      else setState({ kind: "permission" });
    } catch {
      setState({ kind: "failed" });
    } finally {
      requesting.current = false;
    }
  }

  if (state.kind === "ready") return <MetricPlot metric={metric} points={state.points} />;
  return (
    <View style={{ gap: 8 }}>
      <T accessibilityLiveRegion="polite" muted>{state.kind === "update-required" ? text.update : text[state.kind]}</T>
      {state.kind === "permission" ? <Button label={settings ? text.settings : text.allow}
        onPress={settings ? openDeviceMetricsSettings : () => void allow()} /> : null}
      {state.kind === "update-required" ? <Button label={text.updateAction} tone="outline" onPress={() => {
        void Linking.openURL("https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata").catch(() => undefined);
      }} /> : null}
      {state.kind === "failed" ? <Button label={text.retry} tone="outline"
        onPress={() => { setState({ kind: "loading" }); setAttempt((n) => n + 1); }} /> : null}
    </View>
  );
}

function MetricPlot({ metric, points }: { metric: DeviceMetric; points: DeviceMetricPoint[] }) {
  const colors = useColors();
  const text = useText(COPY);
  const language = useLanguage();
  const [index, setIndex] = useState<number>();
  const recorded = points.flatMap(({ value }) => value === null ? [] : [value]);
  if (!recorded.length) return <View style={{ gap: 8 }}>
    <T muted>{text.empty}</T>
    <Button label={text.settings} tone="outline" onPress={openDeviceMetricsSettings} />
  </View>;

  const selected = index ?? points.findLastIndex(({ value }) => value !== null);
  const current = points[selected]!;
  const level = LEVELS.has(metric);
  const closed = level ? recorded : points.slice(0, -1).flatMap(({ value }) => value === null ? [] : [value]);
  const mean = closed.length ? closed.reduce((sum, value) => sum + value, 0) / closed.length : null;
  const move = (step: -1 | 1) => {
    if (!points[selected + step]) return false;
    setIndex(selected + step);
    return true;
  };
  const formatter = new Intl.NumberFormat(LOCALES[language], { maximumFractionDigits: 1 });
  const format = (value: number | null) => value === null ? text.missing : [formatter.format(value), UNITS[metric]].filter(Boolean).join(" ");
  const color = colors.pageInk.insights;

  return (
    <View style={styles.history}>
      <View style={styles.heading}>
        <View accessibilityLiveRegion="polite" style={{ flex: 1 }}>
          <T weight="semibold" style={{ fontSize: 26 }}>{format(current.value)}</T>
          <T muted>{dayParts(current.day, language).dayMonth}{!level && selected === points.length - 1 ? ` · ${text.partial}` : ""}</T>
        </View>
        {([[-1, ChevronLeft, text.previous], [1, ChevronRight, text.next]] as const).map(([step, Icon, label]) =>
          <Press key={step} accessibilityRole="button" accessibilityLabel={label} disabled={!points[selected + step]}
            onPress={() => move(step)} style={[styles.arrow, { borderColor: colors.border, opacity: points[selected + step] ? 1 : 0.4 }]}>
            <Icon size={18} color={colors.foreground} />
          </Press>)}
      </View>
      <DayPlot points={points} selected={selected} onSelect={setIndex} label={text.metric[metric]}
        level={level} partial={!level} color={color} format={format} />
      {mean !== null ? <T>{level ? text.average : text.finished} · {format(mean)}</T> : null}
      <T muted style={{ fontSize: 12 }}>{text.coverage(recorded.length, points.length)}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 12, borderRadius: 16, borderWidth: 1 },
  heading: { flexDirection: "row", alignItems: "center", gap: 9 },
  icon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  small: { fontSize: 12 },
  selector: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12 },
  arrow: { width: 48, height: 48, borderWidth: 1, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  option: { minHeight: 44, borderRadius: 9, paddingHorizontal: 10, alignItems: "center", justifyContent: "center" },
  history: { gap: 8 },
});

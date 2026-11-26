import type { BodyshopEnergyEstimate } from "@tools-platform/service/bodyshop-contract";
import { StyleSheet, View } from "react-native";
import { dayParts, T } from "../kit";
import { LOCALES, useLanguage, useText } from "../language";
import { tint, useColors } from "../theme";

const COPY = {
  en: {
    title: "Maintenance calories",
    unit: "kcal/day",
    range: (low: string, high: string) => `Model range: ${low}–${high} kcal/day`,
    state: { Building: "Building estimate", Updating: "Updating", Holding: "Holding last estimate", "Open day": "Day in progress", Review: "Review needed", Stale: "Estimate out of date" },
    missing: "The model needs more complete food logs and weigh-ins before it can show a maintenance estimate.",
    closed: (date: string) => `Based on closed days through ${date}`,
    accepted: (date: string) => `Last model update: ${date}`,
    intake: "Recent intake",
    days: (days: number) => `${days} complete logs in the last 7 closed days`,
    target: "Daily calorie target",
    balance: "Estimated intake minus maintenance",
    about: "Maintenance estimates the calories you burn per day. The range shows how much the estimate may vary.",
  },
  de: {
    title: "Erhaltungskalorien",
    unit: "kcal/Tag",
    range: (low: string, high: string) => `Modellbereich: ${low}–${high} kcal/Tag`,
    state: { Building: "Schätzung im Aufbau", Updating: "Wird aktualisiert", Holding: "Letzte Schätzung", "Open day": "Tag läuft noch", Review: "Prüfung nötig", Stale: "Schätzung veraltet" },
    missing: "Das Modell braucht mehr vollständige Ernährungsprotokolle und Gewichtsmessungen für eine Schätzung.",
    closed: (date: string) => `Aus abgeschlossenen Tagen bis ${date}`,
    accepted: (date: string) => `Letzte Modellaktualisierung: ${date}`,
    intake: "Letzte Kalorienaufnahme",
    days: (days: number) => `${days} vollständige Protokolle in den letzten 7 abgeschlossenen Tagen`,
    target: "Tägliches Kalorienziel",
    balance: "Geschätzte Aufnahme minus Erhaltungsbedarf",
    about: "Die Erhaltungskalorien schätzen deinen täglichen Energieverbrauch. Der Bereich zeigt, wie stark die Schätzung schwanken kann.",
  },
};

export function EnergyCard({ estimate, target }: { estimate: BodyshopEnergyEstimate; target: number }) {
  const text = useText(COPY);
  const language = useLanguage();
  const colors = useColors();
  const number = new Intl.NumberFormat(LOCALES[language], { maximumFractionDigits: 0 });
  const amount = (value: number) => `${number.format(value)} ${text.unit}`;
  const accent = colors.pageInk.insights;
  const ready = estimate.tdeeMid !== null;
  const closed = dayParts(estimate.closedThrough, language).dayMonth;

  return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <T accessibilityRole="header" weight="semibold" style={{ fontSize: 19 }}>{text.title}</T>
      <T muted>{text.state[estimate.state]}</T>
      {estimate.tdeeMid !== null ? <>
        <T weight="semibold" style={{ fontSize: 30, color: accent }}>≈ {amount(Math.round(estimate.tdeeMid / 50) * 50)}</T>
        {estimate.tdeeLow !== null && estimate.tdeeHigh !== null ? <T>{text.range(number.format(Math.floor(estimate.tdeeLow / 50) * 50), number.format(Math.ceil(estimate.tdeeHigh / 50) * 50))}</T> : null}
        <T muted style={styles.small}>{text.about}</T>
      </> : <T muted>{text.missing}</T>}
      <View style={[styles.comparison, { borderTopColor: colors.border }]}>
        {estimate.recentIntake !== null ? <View style={styles.item}>
          <T muted style={styles.small}>{text.intake}</T>
          <T weight="semibold">{amount(estimate.recentIntake)}</T>
          <T muted style={styles.small}>{text.days(estimate.recentCompleteDays)}</T>
        </View> : null}
        <View style={styles.item}>
          <T muted style={styles.small}>{text.target}</T>
          <T weight="semibold">{amount(target)}</T>
        </View>
      </View>
      {estimate.balanceMid !== null ? (
        <View style={[styles.balance, { backgroundColor: tint(accent, 10, colors.card) }]}>
          <T>{text.balance}</T>
          <T weight="semibold">{new Intl.NumberFormat(LOCALES[language], { maximumFractionDigits: 0, signDisplay: "exceptZero" }).format(Math.round(estimate.balanceMid))} {text.unit}</T>
        </View>
      ) : null}
      <T muted style={styles.small}>{ready && estimate.lastAccepted ? text.accepted(dayParts(estimate.lastAccepted, language).dayMonth) : text.closed(closed)}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 8, borderWidth: 1, borderRadius: 16 },
  comparison: { flexDirection: "row", flexWrap: "wrap", gap: 12, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 },
  item: { flex: 1, minWidth: 115, gap: 3 },
  balance: { gap: 3, padding: 10, borderRadius: 10 },
  small: { fontSize: 12 },
});

import { useState } from "react";
import Svg, { Circle, G, Line, Rect, Text } from "react-native-svg";
import { Press, T, dayParts } from "../kit";
import { LOCALES, useLanguage, useText } from "../language";
import { SwipeStepArea } from "../swipe-step-area";
import { tint, useColors } from "../theme";
import { View } from "react-native";

const COPY = {
  en: { missing: "Dashes below the chart mark days with no data." },
  de: { missing: "Striche unter dem Diagramm markieren Tage ohne Daten." },
};

export function DayPlot({ points, selected, onSelect, label, format, color, level = false, prior, partial = false }: {
  points: readonly { day: string; value: number | null }[];
  selected: number;
  onSelect: (index: number) => void;
  label: string;
  format: (value: number | null) => string;
  color: string;
  level?: boolean;
  prior?: number | null;
  partial?: boolean;
}) {
  const colors = useColors();
  const language = useLanguage();
  const copy = useText(COPY);
  const [width, setWidth] = useState(0);
  const current = points[selected];
  if (!current) return null;
  const values = points.flatMap(({ value }) => value === null ? [] : [value]);
  if (!values.length) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padding = Math.max((high - low) * 0.15, 0.5);
  const min = level ? low - padding : 0;
  const max = level ? high + padding : Math.max(high, prior ?? 0, 1);
  const plotWidth = Math.max(1, width - 60);
  const slot = plotWidth / points.length;
  const x = (index: number) => (index + 0.5) * slot + 4;
  const y = (value: number) => 118 - (value - min) / (max - min) * 104;
  const move = (step: number) => {
    if (!points[selected + step]) return false;
    onSelect(selected + step);
    return true;
  };
  const ticks = new Intl.NumberFormat(LOCALES[language], { notation: "compact", maximumFractionDigits: level ? 1 : 2 });

  return <View style={{ gap: 4 }}>
    <SwipeStepArea onStep={move}>
      <Press style={{ height: 131 }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        accessibilityRole="adjustable" accessibilityLabel={label}
        accessibilityValue={{ text: `${dayParts(current.day, language).dayMonth}, ${format(current.value)}` }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(event) => move(event.nativeEvent.actionName === "increment" ? 1 : -1)}
        onPress={(event) => onSelect(Math.min(points.length - 1, Math.max(0, Math.floor((event.nativeEvent.locationX - 4) / slot))))}>
        <View pointerEvents="none">
          {width > 60 ? <Svg width={width} height={131}>
            <Rect x={x(selected) - slot / 2} y={7} width={slot} height={117} rx={4} fill={colors.muted} />
            {[min, (min + max) / 2, max].map((value) => <G key={value}>
              <Line x1={4} x2={4 + plotWidth} y1={y(value)} y2={y(value)} stroke={colors.controlBorder} />
              <Text x={plotWidth + 10} y={y(value) + 4} fontSize={11} fill={colors.mutedForeground}>{ticks.format(value)}</Text>
            </G>)}
            <Line x1={x(selected)} x2={x(selected)} y1={7} y2={124} stroke={colors.mutedForeground} strokeDasharray="2 4" />
            {points.map(({ day, value }, index) => {
              const previous = points[index - 1]?.value;
              const fill = partial && index === points.length - 1 ? colors.mutedForeground : index === selected ? color : tint(color, 62, colors.card);
              const barWidth = Math.min(slot * 0.68, 26);
              if (value === null) return <Line key={day} x1={x(index) - barWidth / 2} x2={x(index) + barWidth / 2}
                y1={125} y2={125} stroke={colors.mutedForeground} strokeDasharray="2 2" />;
              if (!level) return <Rect key={day} x={x(index) - barWidth / 2} y={Math.min(y(value), 115)}
                width={barWidth} height={Math.max(3, 118 - y(value))} rx={Math.min(3, barWidth / 2)} fill={fill} />;
              return <G key={day}>
                {previous != null ? <Line x1={x(index - 1)} x2={x(index)} y1={y(previous)} y2={y(value)} stroke={color} strokeWidth={2} /> : null}
                <Circle cx={x(index)} cy={y(value)} r={index === selected ? 5 : 3} fill={color} />
              </G>;
            })}
            {prior != null ? <Line x1={4} x2={4 + plotWidth} y1={y(prior)} y2={y(prior)} stroke={colors.foreground} strokeDasharray="5 4" /> : null}
          </Svg> : null}
        </View>
      </Press>
    </SwipeStepArea>
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingRight: 54 }}>
      <T muted style={{ fontSize: 12 }}>{dayParts(points[0]!.day, language).dayMonth}</T>
      <T muted style={{ fontSize: 12 }}>{dayParts(points.at(-1)!.day, language).dayMonth}</T>
    </View>
    {values.length < points.length ? <T muted style={{ fontSize: 12 }}>{copy.missing}</T> : null}
  </View>;
}

"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../src/lib/utils.js";
import { Card } from "../src/components/ui/card.js";
import type { MoneySpendingAnalytics } from "./money-repository.js";

/* ---------- Formatting ---------- */

const euro0 = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const euro2 = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Euro amount with a real minus sign. `signed` adds a plus for gains. */
export function formatEuro(value: number, options: { precise?: boolean; signed?: boolean } = {}) {
  const text = (options.precise ? euro2 : euro0).format(Math.abs(value));
  return `${value < 0 && Math.round(Math.abs(value) * (options.precise ? 100 : 1)) !== 0 ? "−" : options.signed && value > 0 ? "+" : ""}${text}`;
}

export function formatMinor(minor: number, options: { precise?: boolean; signed?: boolean } = {}) {
  return formatEuro(minor / 100, options);
}

/** Axis labels: 73.600 € becomes "73,6k". */
export function formatCompact(value: number) {
  const absolute = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (absolute >= 1_000_000) return `${sign}${(absolute / 1_000_000).toLocaleString("de-DE", { maximumFractionDigits: 1 })}M`;
  if (absolute >= 1_000) return `${sign}${(absolute / 1_000).toLocaleString("de-DE", { maximumFractionDigits: 1 })}k`;
  return `${sign}${Math.round(absolute)}`;
}

/** A ratio as a percentage: 0.124 becomes "+12.4%" when signed. */
export function formatRatio(ratio: number | undefined, signed = false) {
  if (ratio === undefined || !Number.isFinite(ratio)) return "—";
  return `${ratio < 0 ? "−" : signed && ratio > 0 ? "+" : ""}${Math.abs(ratio * 100).toFixed(1)}%`;
}

/** "2026-08" or "2026-08-01" becomes "Aug 2026"; `short` gives "Aug 26". */
export function formatMonth(value: string, short = false) {
  const [year, month] = value.split("-");
  const name = MONTHS[Number(month) - 1] ?? month;
  return short ? `${name} ${year?.slice(2)}` : `${name} ${year}`;
}

/** "2026-09-24" becomes "24 Sep", with the year when it is not the current year. */
export function formatDay(value: string, withYear = false) {
  const [year, month, day] = value.slice(0, 10).split("-");
  const name = MONTHS[Number(month) - 1] ?? month;
  return withYear || year !== String(new Date().getFullYear()) ? `${Number(day)} ${name} ${year}` : `${Number(day)} ${name}`;
}

export function toneClass(value: number | undefined) {
  return value === undefined || value === 0 ? "" : value < 0 ? "text-negative" : "text-positive";
}

/* ---------- Layout ---------- */

/** A card with a compact header. Descriptions are optional; most panels explain themselves. */
export function MoneyPanel({
  title,
  description,
  actions,
  children,
  className,
  label,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <Card className={cn("money-panel gap-0 py-0", className)} aria-label={label}>
      {title || actions ? (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 pt-3.5">
          <div className="min-w-0">
            {title ? <h2 className="text-sm font-semibold">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </Card>
  );
}

export function PanelBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-4 pt-3 pb-4", className)}>{children}</div>;
}

export function PanelFooter({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-x-5 gap-y-1 border-t px-4 py-2.5 text-xs text-muted-foreground">{children}</div>;
}

/** Several numbers in one row. Each number has a label and one line of context. */
export function StatStrip({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("money-strip", className)} aria-label={label}>
      {children}
    </section>
  );
}

export function Stat({ label, value, detail, tone }: { label: string; value: ReactNode; detail?: ReactNode; tone?: number }) {
  return (
    <div className="money-stat">
      <p className="money-stat__label">{label}</p>
      <p className={cn("money-stat__value", toneClass(tone))}>{value}</p>
      {detail ? <p className="money-stat__detail">{detail}</p> : null}
    </div>
  );
}

/** A single choice from a few options, such as a time range. */
export function Segmented<Value extends string>({
  label,
  options,
  value,
  onValue,
}: {
  label: string;
  options: readonly (readonly [Value, string])[];
  value: Value;
  onValue: (value: Value) => void;
}) {
  return (
    <div className="money-segmented" role="group" aria-label={label}>
      {options.map(([option, text]) => (
        <button key={option} type="button" aria-pressed={option === value} onClick={() => onValue(option)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** The table view of a chart, closed by default. */
export function TableTwin({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="money-twin">
      <summary>{label}</summary>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={label}>
        {children}
      </div>
    </details>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="grid min-h-28 place-items-center px-4 py-6 text-center">
      <div>
        <p className="text-sm font-medium">{title}</p>
        {children ? <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{children}</p> : null}
      </div>
    </div>
  );
}

/* ---------- Inline marks ---------- */

/** Share of the largest value, drawn as a bar in a table cell. */
export function ShareBar({ ratio, className }: { ratio: number; className?: string }) {
  return (
    <span className={cn("money-bar", className)} aria-hidden="true">
      <span style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }} />
    </span>
  );
}

/** A gain to the right of the centre line, a loss to the left. */
export function DivergingBar({ value, maximum, className }: { value: number; maximum: number; className?: string }) {
  const width = maximum ? Math.min(1, Math.abs(value) / maximum) * 50 : 0;
  return (
    <span className={cn("money-diverging", className)} aria-hidden="true">
      <span
        data-tone={value < 0 ? "negative" : "positive"}
        style={value < 0 ? { right: "50%", width: `${width}%` } : { left: "50%", width: `${width}%` }}
      />
    </span>
  );
}

/** A bar for this period and a tick for the usual amount. */
export function BulletBar({ value, marker, maximum }: { value: number; marker: number; maximum: number }) {
  const scale = (amount: number) => `${maximum ? Math.min(1, amount / maximum) * 100 : 0}%`;
  return (
    <span className="money-bullet" aria-hidden="true">
      <span style={{ width: scale(value) }} />
      <i style={{ left: scale(marker) }} />
    </span>
  );
}

/** Small monthly bars. The highlighted month is drawn in the text colour. */
export function SparkBars({ values, highlight, partialLast = false }: { values: readonly number[]; highlight?: number; partialLast?: boolean }) {
  const width = 84;
  const height = 22;
  const gap = 2;
  const barWidth = values.length ? (width - gap * (values.length - 1)) / values.length : 0;
  const maximum = Math.max(...values, 1);
  return (
    <svg className="money-spark" width={width} height={height} aria-hidden="true">
      {values.map((value, index) => {
        const barHeight = Math.max(1, (value / maximum) * height);
        const state = index === highlight ? "on" : partialLast && index === values.length - 1 ? "partial" : "off";
        return <rect key={index} data-state={state} x={index * (barWidth + gap)} y={height - barHeight} width={barWidth} height={barHeight} rx={1.5} />;
      })}
    </svg>
  );
}

export function SparkLine({ values }: { values: readonly number[] }) {
  const width = 96;
  const height = 24;
  if (values.length < 2) return <svg className="money-spark" width={width} height={height} aria-hidden="true" />;
  const minimum = Math.min(...values);
  const range = Math.max(...values) - minimum || 1;
  const points = values.map((value, index) => [(index / (values.length - 1)) * (width - 3), height - 3 - ((value - minimum) / range) * (height - 6)] as const);
  const last = points.at(-1)!;
  return (
    <svg className="money-spark money-spark--line" width={width} height={height} aria-hidden="true">
      <polyline points={points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")} />
      <circle cx={last[0]} cy={last[1]} r={2.5} />
    </svg>
  );
}

/* ---------- Charts ---------- */

/** Measures the container so the SVG draws at its real size, which keeps text sharp. */
function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceTicks(minimum: number, maximum: number, count: number) {
  const span = maximum - minimum || Math.abs(maximum) || 1;
  let step = 10 ** Math.floor(Math.log10(span / count));
  const error = span / count / step;
  step *= error >= 7.5 ? 10 : error >= 3.5 ? 5 : error >= 1.5 ? 2 : 1;
  const low = Math.floor(minimum / step) * step;
  const high = Math.ceil(maximum / step) * step;
  const ticks: number[] = [];
  for (let tick = low; tick <= high + step / 2; tick += step) ticks.push(Math.round(tick * 1000) / 1000);
  return ticks;
}

/** Labels at least `gap` pixels apart, always including the last point. */
function labelIndexes(count: number, plotWidth: number, gap = 76) {
  const every = Math.max(1, Math.ceil(count / Math.max(2, Math.floor(plotWidth / gap))));
  return Array.from({ length: count }, (_, index) => index).filter((index) => (count - 1 - index) % every === 0);
}

type TooltipRow = readonly [label: string, value: string, swatch?: string];
export type ChartTooltip = Readonly<{ title: string; rows: readonly (TooltipRow | "divider")[]; hint?: string }>;

/** Swatch colours for tooltips and legends, matching the chart marks. */
export const SERIES = {
  primary: "var(--money-series-1)",
  secondary: "var(--money-series-2)",
  income: "var(--positive)",
  spending: "var(--negative)",
  net: "var(--foreground)",
  muted: "var(--muted-foreground)",
} as const;

/** The SVG, its hover state, and the tooltip. The chart owns the scales. */
function ChartFrame({
  width,
  height,
  label,
  count,
  xFor,
  band,
  tooltip,
  onSelect,
  children,
}: {
  width: number;
  height: number;
  label: string;
  count: number;
  xFor: (index: number) => number;
  /** Bar charts pick the band under the pointer; line charts pick the nearest point. */
  band?: number;
  tooltip: (index: number) => ChartTooltip;
  onSelect?: (index: number) => void;
  children: (hover: number | undefined) => ReactNode;
}) {
  const [hover, setHover] = useState<number>();
  const indexAt = (clientX: number, element: SVGSVGElement) => {
    const x = clientX - element.getBoundingClientRect().left;
    if (band) return Math.max(0, Math.min(count - 1, Math.floor((x - xFor(0) + band / 2) / band)));
    let nearest = 0;
    for (let index = 1; index < count; index += 1) if (Math.abs(xFor(index) - x) < Math.abs(xFor(nearest) - x)) nearest = index;
    return nearest;
  };
  const tip = hover === undefined || hover >= count ? undefined : tooltip(hover);
  const tipLeft = hover === undefined ? 0 : xFor(hover) + 14;
  return (
    <>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={label}
        className={onSelect ? "cursor-pointer" : undefined}
        onPointerMove={(event) => setHover(indexAt(event.clientX, event.currentTarget))}
        onPointerLeave={() => setHover(undefined)}
        onClick={onSelect ? (event) => onSelect(indexAt(event.clientX, event.currentTarget)) : undefined}
      >
        {children(hover === undefined || hover >= count ? undefined : hover)}
      </svg>
      {tip ? (
        <div className="money-tooltip" role="presentation" style={tipLeft + 200 > width ? { right: Math.max(0, width - tipLeft + 28), top: 4 } : { left: tipLeft, top: 4 }}>
          <p className="money-tooltip__title">{tip.title}</p>
          {tip.rows.map((row, index) =>
            row === "divider" ? (
              <hr key={index} />
            ) : (
              <p key={index} className="money-tooltip__row">
                <span>
                  {row[2] ? <i style={{ background: row[2] }} /> : null}
                  {row[0]}
                </span>
                <span>{row[1]}</span>
              </p>
            ),
          )}
          {tip.hint ? <p className="money-tooltip__hint">{tip.hint}</p> : null}
        </div>
      ) : null}
    </>
  );
}

function YAxis({ ticks, y, left, right }: { ticks: readonly number[]; y: (value: number) => number; left: number; right: number }) {
  return (
    <g className="money-axis">
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={left} x2={right} y1={y(tick)} y2={y(tick)} data-zero={tick === 0 || undefined} />
          <text x={left - 8} y={y(tick) + 4} textAnchor="end">
            {formatCompact(tick)}
          </text>
        </g>
      ))}
    </g>
  );
}

function linearScale(domain: readonly number[], top: number, plotHeight: number) {
  const low = domain[0]!;
  const high = domain.at(-1)!;
  return (value: number) => top + ((high - value) / (high - low || 1)) * plotHeight;
}

function pathFor(points: readonly (readonly [number, number])[]) {
  return points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
}

/** One series over time with a tight axis, so month-to-month change stays visible. */
export function LineTrendChart({
  points,
  label,
  height = 240,
  marker,
  tooltip,
}: {
  points: readonly Readonly<{ label: string; value: number }>[];
  label: string;
  height?: number;
  marker?: Readonly<{ index: number; label: string }>;
  tooltip: (index: number) => ChartTooltip;
}) {
  const [ref, width] = useWidth(640);
  const left = 52;
  const top = 16;
  const bottom = 24;
  const right = width - 10;
  const plotHeight = height - top - bottom;
  const values = points.map((point) => point.value);
  const ticks = niceTicks(Math.min(...values), Math.max(...values), 4);
  const y = linearScale(ticks, top, plotHeight);
  const x = (index: number) => left + (points.length < 2 ? (right - left) / 2 : (index / (points.length - 1)) * (right - left));
  const last = points.at(-1);
  return (
    <div ref={ref} className="money-chart" style={{ height }}>
      {points.length ? (
        <ChartFrame width={width} height={height} label={label} count={points.length} xFor={x} tooltip={tooltip}>
          {(hover) => (
            <>
              <YAxis ticks={ticks} y={y} left={left} right={right} />
              {marker && marker.index >= 0 && marker.index < points.length ? (
                <g className="money-marker">
                  <line x1={x(marker.index)} x2={x(marker.index)} y1={top} y2={top + plotHeight} />
                  <text x={x(marker.index) - 6} y={top + plotHeight - 6} textAnchor="end">{marker.label}</text>
                </g>
              ) : null}
              <path className="money-series" data-series="1" d={pathFor(points.map((point, index) => [x(index), y(point.value)]))} />
              {last ? (
                <>
                  <circle className="money-dot" data-series="1" cx={x(points.length - 1)} cy={y(last.value)} r={4} />
                  <text className="money-end-label" x={x(points.length - 1) - 8} y={y(last.value) - 10} textAnchor="end">{formatCompact(last.value)}</text>
                </>
              ) : null}
              <g className="money-axis">
                {labelIndexes(points.length, right - left).map((index) => (
                  <text key={index} x={x(index)} y={height - 6} textAnchor={index === points.length - 1 ? "end" : "middle"}>{points[index]!.label}</text>
                ))}
              </g>
              {hover !== undefined ? (
                <g className="money-hover">
                  <line x1={x(hover)} x2={x(hover)} y1={top} y2={top + plotHeight} />
                  <circle cx={x(hover)} cy={y(points[hover]!.value)} r={4} />
                </g>
              ) : null}
            </>
          )}
        </ChartFrame>
      ) : null}
    </div>
  );
}

export type FlowMonth = Readonly<{ label: string; income: number; spending: number; net: number; partial?: boolean }>;

/** Income above zero, spending below, net as a dot. One axis in euro. */
export function FlowChart({
  months,
  label,
  height = 210,
  selected,
  onSelect,
  tooltip,
}: {
  months: readonly FlowMonth[];
  label: string;
  height?: number;
  selected?: number;
  onSelect?: (index: number) => void;
  tooltip: (index: number) => ChartTooltip;
}) {
  const [ref, width] = useWidth(640);
  const left = 48;
  const top = 8;
  const bottom = 24;
  const right = width - 6;
  const plotHeight = height - top - bottom;
  const ticks = niceTicks(-Math.max(...months.map((month) => month.spending), 1), Math.max(...months.map((month) => month.income), 1), 4);
  const y = linearScale(ticks, top, plotHeight);
  const slot = (right - left) / Math.max(months.length, 1);
  const barWidth = Math.min(24, slot * 0.56);
  const x = (index: number) => left + slot * (index + 0.5);
  return (
    <div ref={ref} className="money-chart" style={{ height }}>
      <ChartFrame width={width} height={height} label={label} count={months.length} xFor={x} band={slot} tooltip={tooltip} onSelect={onSelect}>
        {(hover) => (
          <>
            <YAxis ticks={ticks} y={y} left={left} right={right} />
            {hover !== undefined ? <rect className="money-band" x={x(hover) - slot / 2} y={top} width={slot} height={plotHeight} rx={4} /> : null}
            {months.map((month, index) => (
              <g key={month.label} data-state={month.partial ? "partial" : selected !== undefined && selected !== index ? "dim" : "on"}>
                <rect className="money-flow-income" x={x(index) - barWidth / 2} y={y(month.income)} width={barWidth} height={Math.max(1, y(0) - y(month.income) - 1)} rx={4} />
                <rect className="money-flow-spending" x={x(index) - barWidth / 2} y={y(0) + 1} width={barWidth} height={Math.max(1, y(-month.spending) - y(0) - 1)} rx={4} />
                <circle className="money-flow-net" cx={x(index)} cy={y(month.net)} r={3.5} />
              </g>
            ))}
            <g className="money-axis">
              {labelIndexes(months.length, right - left, 44).map((index) => (
                <text key={index} x={x(index)} y={height - 6} textAnchor="middle" data-selected={index === selected || undefined}>
                  {months[index]!.label}
                </text>
              ))}
            </g>
          </>
        )}
      </ChartFrame>
    </div>
  );
}

/** Monthly bars for one category with a dashed average line. */
export function MonthBars({
  values,
  labels,
  label,
  highlight,
  average,
  height = 130,
  tooltip,
}: {
  values: readonly number[];
  labels: readonly string[];
  label: string;
  highlight?: number;
  average: number;
  height?: number;
  tooltip: (index: number) => ChartTooltip;
}) {
  const [ref, width] = useWidth(420);
  const left = 40;
  const top = 6;
  const bottom = 22;
  const right = width - 4;
  const plotHeight = height - top - bottom;
  const ticks = niceTicks(0, Math.max(...values, average, 1), 2);
  const y = linearScale(ticks, top, plotHeight);
  const slot = (right - left) / Math.max(values.length, 1);
  const barWidth = Math.min(20, slot * 0.62);
  const x = (index: number) => left + slot * (index + 0.5);
  return (
    <div ref={ref} className="money-chart" style={{ height }}>
      <ChartFrame width={width} height={height} label={label} count={values.length} xFor={x} band={slot} tooltip={tooltip}>
        {(hover) => (
          <>
            <YAxis ticks={ticks} y={y} left={left} right={right} />
            {hover !== undefined ? <rect className="money-band" x={x(hover) - slot / 2} y={top} width={slot} height={plotHeight} rx={4} /> : null}
            {values.map((value, index) => (
              <rect key={index} className="money-month-bar" data-state={index === highlight ? "on" : "off"} x={x(index) - barWidth / 2} y={y(value)} width={barWidth} height={Math.max(1, y(0) - y(value))} rx={4} />
            ))}
            <line className="money-average" x1={left} x2={right} y1={y(average)} y2={y(average)} />
            <text className="money-end-label" x={right} y={y(average) - 5} textAnchor="end">avg {formatCompact(average)}</text>
            <g className="money-axis">
              {labelIndexes(values.length, right - left, 52).map((index) => (
                <text key={index} x={x(index)} y={height - 5} textAnchor="middle">{labels[index]}</text>
              ))}
            </g>
          </>
        )}
      </ChartFrame>
    </div>
  );
}

export type FanPoint = Readonly<{ label: string; observed?: number; central?: number; low?: number; high?: number; inflation?: number }>;

/** Observed history, then the central estimate inside its 80% range, with an inflation-only line. */
export function FanChart({ points, label, height = 260, tooltip }: { points: readonly FanPoint[]; label: string; height?: number; tooltip: (index: number) => ChartTooltip }) {
  const [ref, width] = useWidth(760);
  const left = 52;
  const top = 14;
  const bottom = 24;
  const right = width - 10;
  const plotHeight = height - top - bottom;
  const values = points.flatMap((point) => [point.observed, point.low, point.high, point.inflation].filter((value): value is number => value !== undefined));
  const ticks = niceTicks(Math.min(...values), Math.max(...values), 4);
  const y = linearScale(ticks, top, plotHeight);
  const x = (index: number) => left + (index / Math.max(points.length - 1, 1)) * (right - left);
  const line = (key: "observed" | "central" | "inflation") =>
    pathFor(points.flatMap((point, index) => (point[key] === undefined ? [] : [[x(index), y(point[key]!)] as const])));
  const range = points.flatMap((point, index) => (point.low === undefined || point.high === undefined ? [] : [{ index, low: point.low, high: point.high }]));
  const band = range.length
    ? `${pathFor(range.map((point) => [x(point.index), y(point.high)]))}${[...range].reverse().map((point) => `L${x(point.index).toFixed(1)},${y(point.low).toFixed(1)}`).join("")}Z`
    : "";
  const today = points.findLastIndex((point) => point.observed !== undefined);
  const end = points.at(-1);
  return (
    <div ref={ref} className="money-chart" style={{ height }}>
      <ChartFrame width={width} height={height} label={label} count={points.length} xFor={x} tooltip={tooltip}>
        {(hover) => (
          <>
            <YAxis ticks={ticks} y={y} left={left} right={right} />
            {band ? <path className="money-fan-band" d={band} /> : null}
            <path className="money-series money-series--dashed" data-series="2" d={line("inflation")} />
            <path className="money-series money-series--dashed" data-series="1" d={line("central")} />
            <path className="money-series" data-series="1" d={line("observed")} />
            {today >= 0 ? <line className="money-today" x1={x(today)} x2={x(today)} y1={top} y2={top + plotHeight} /> : null}
            {end?.central !== undefined ? <text className="money-end-label" x={x(points.length - 1) - 4} y={y(end.central) - 8} textAnchor="end">{formatCompact(end.central)} €</text> : null}
            <g className="money-axis">
              <text x={x(0)} y={height - 6} textAnchor="start">{points[0]?.label}</text>
              {today > 0 && today < points.length - 1 ? <text x={x(today)} y={height - 6} textAnchor="middle">Today</text> : null}
              <text x={x(points.length - 1)} y={height - 6} textAnchor="end">{end?.label}</text>
            </g>
            {hover !== undefined ? <line className="money-hover-line" x1={x(hover)} x2={x(hover)} y1={top} y2={top + plotHeight} /> : null}
          </>
        )}
      </ChartFrame>
    </div>
  );
}

/** The reconciliation of one month, shown where the month is plotted. */
export function flowTooltip(month: MoneySpendingAnalytics["months"][number]): ChartTooltip {
  return {
    title: formatMonth(month.month),
    rows: [
      ["Income", formatMinor(month.incomeMinor), SERIES.income],
      ["Refunds", formatMinor(month.refundsMinor)],
      ["Spending", formatMinor(-month.spendMinor), SERIES.spending],
      ["Fees and taxes", formatMinor(-(month.feesMinor + month.taxesMinor))],
      "divider",
      ["Net flow", formatMinor(month.netCashFlowMinor, { signed: true }), SERIES.net],
    ],
  };
}

/** Legend entry for a chart with two or more series. */
export function LegendItem({ color, shape = "square", children }: { color: string; shape?: "square" | "line" | "dash" | "dot"; children: ReactNode }) {
  return (
    <span className="money-legend__item">
      <i data-shape={shape} style={shape === "dash" ? { borderColor: color } : { background: color }} />
      {children}
    </span>
  );
}

export function Legend({ children }: { children: ReactNode }) {
  return <div className="money-legend">{children}</div>;
}

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { Segmented } from "../../../platform/ui/components/segmented.js";
import { ChartContainer } from "../../../platform/ui/components/ui/chart.js";
import type { getBodyshopProgress } from "../server-functions.js";
import { BodyshopPage, ChartTip, COLORS, dayLabel, fmt, shortDay, signed } from "./kit.js";

type Data = Awaited<ReturnType<typeof getBodyshopProgress>>;
type Row = Data["rows"][number] & { band: [number, number] | null; eaten: number | null; partial: number | null; projected?: number | null; projectedBand?: [number, number] | null };

const SPANS = [["30", "30 days"], ["90", "90 days"], ["all", "All"]] as const;

/** Each model state in the color of what it means for the numbers above it. */
const STATE_COLORS: Record<string, string> = { Updating: COLORS.good, Holding: COLORS.burn, Stale: COLORS.flag, Review: COLORS.flag };

const axis = { tickLine: false, axisLine: false, tick: { fontSize: 11, fill: "var(--muted-foreground)" } } as const;

export function ProgressPage({ data, children }: { data: Data; children?: ReactNode }) {
  const [span, setSpan] = useState<(typeof SPANS)[number][0]>("90");
  // A phone shows a month: ninety daily bars are too thin to read at that width.
  useEffect(() => { if (window.matchMedia("(max-width: 767px)").matches) setSpan("30"); }, []);
  const s = data.summary;
  const rows: Row[] = useMemo(() => {
    const all = data.rows.map((row) => ({
      ...row, band: row.expenditureLow !== null && row.expenditureHigh !== null ? [row.expenditureLow, row.expenditureHigh] as [number, number] : null,
      eaten: row.eligible ? row.kcal : null, partial: !row.eligible && row.kcal ? row.kcal : null
    }));
    const shown = span === "all" ? all : all.slice(-Number(span));
    // The projection continues the chart past today, so its days get rows of their own.
    const future = data.projection.path.filter((point) => point.day > (shown.at(-1)?.day ?? "")).map((point) => ({
      day: point.day, actual: null, display: null, trend: null, status: "Unknown", kcal: null, modeled: null, eligible: false,
      expenditure: null, expenditureLow: null, expenditureHigh: null, state: "Open day", band: null, eaten: null, partial: null
    })) as Row[];
    const path = new Map(data.projection.path.map((point) => [point.day, point]));
    return [...shown, ...future].map((row) => {
      const point = path.get(row.day);
      return { ...row, projected: point?.kg ?? null, projectedBand: point ? [point.low, point.high] as [number, number] : null };
    });
  }, [data.rows, data.projection.path, span]);

  const goal = { low: data.settings.goalLow, high: data.settings.goalHigh };
  const weights = rows.flatMap((row) => [row.actual, row.trend, ...(row.projectedBand ?? [])]).filter((value): value is number => value !== null);
  const [min, max] = weights.length ? [Math.min(...weights), Math.max(...weights)] : [goal.low, goal.high];
  const goalInView = goal.high >= min - 1.5 && goal.low <= max + 1.5;
  const domain: [number, number] = [Math.floor(Math.min(min, goalInView ? goal.low : min) - 0.5), Math.ceil(Math.max(max, goalInView ? goal.high : max) + 0.5)];
  const lastTrend = [...rows].reverse().find((row) => row.trend !== null);

  return (
    <BodyshopPage title="Progress" actions={<Segmented label="Time span" options={SPANS} value={span} onValue={setSpan} />}>
      <dl className="grid grid-cols-2 border-y-2 border-foreground/80 lg:grid-cols-4">
        <Readout label="Trend weight" value={s.trend === null ? "–" : fmt(s.trend, 1)} unit="kg"
          note={s.latestWeight !== null && s.latestWeighIn ? `Weighed ${fmt(s.latestWeight, 1)} kg ${dayLabel(s.latestWeighIn, data.today).toLowerCase()}` : "No weigh-in yet"} />
        <Readout label="Expenditure" value={s.tdeeMid === null ? "–" : fmt(s.tdeeMid)} unit="kcal" color={COLORS.burn}
          note={s.tdeeLow !== null && s.tdeeHigh !== null ? `Range ${fmt(s.tdeeLow)} to ${fmt(s.tdeeHigh)}` : "Not enough data yet"} />
        <Readout label="Eaten, last 7 days" value={s.recentIntake === null ? "–" : fmt(s.recentIntake)} unit="kcal" color={COLORS.energy}
          note={`Mean of ${s.recentCompleteDays} complete ${s.recentCompleteDays === 1 ? "day" : "days"}`} />
        <Readout label="Balance" value={s.balanceMid === null ? "–" : signed(s.balanceMid)} unit={s.balanceMid === null ? "" : "kcal"}
          note={s.weeklyChangeLow !== null && s.weeklyChangeHigh !== null ? `${signed(s.weeklyChangeLow, 2)} to ${signed(s.weeklyChangeHigh, 2)} kg a week` : "Shows while the model is updating"} />
      </dl>

      <p className="mt-3 max-w-[72ch] text-sm">
        <span className="mr-1.5 inline-flex items-center gap-1.5 font-semibold" style={{ color: STATE_COLORS[s.state] }}>
          <span aria-hidden className="size-2 rounded-full" style={{ background: STATE_COLORS[s.state] ?? "var(--muted-foreground)" }} />{s.state}.
        </span>
        <span>{s.gate}.</span>{" "}
        <span className="text-muted-foreground">
          The last {s.windowDays} days have {s.completeDays} complete logs and {s.weightDays} weigh-in days.
          {s.legacyCompletions ? ` ${s.legacyCompletions} of them count as complete only by the old automatic rule.` : ""} Ranges are scenarios, not confidence intervals.
        </span>
      </p>

      {data.energy.decision ? (
        <p className="mt-4 max-w-[72ch] border-l-4 pl-3 text-sm" style={{ borderColor: COLORS.burn }}>{sentenceCase(data.energy.decision)}</p>
      ) : null}

      <ChartSection title="Weight" legend={[{ color: COLORS.trend, label: "Trend" }, { color: COLORS.trend, label: "Weigh-in", dot: true }, ...(data.projection.path.length ? [{ color: COLORS.trend, label: "Projection", dashed: true }] : []), ...(goalInView ? [{ color: COLORS.good, label: `Goal ${fmt(goal.low)} to ${fmt(goal.high)} kg`, area: true }] : [])]}
        note={data.projection.summary}>
        <ChartContainer config={{}} className="aspect-auto h-72 w-full sm:h-80" initialDimension={{ width: 760, height: 320 }} role="img" aria-label="Daily weigh-ins and the smoothed trend weight in kg">
          <ComposedChart data={rows} margin={{ top: 12, left: 0, right: 44, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
            {goalInView ? <ReferenceArea y1={goal.low} y2={goal.high} fill={COLORS.good} fillOpacity={0.12} stroke="none" ifOverflow="hidden" /> : null}
            <XAxis dataKey="day" {...axis} tickMargin={8} minTickGap={36} tickFormatter={shortDay} />
            <YAxis {...axis} domain={domain} width={36} allowDecimals={false} tickFormatter={(value: number) => fmt(value)} />
            <Tooltip cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }} content={({ active, payload }) => {
              const row = payload?.[0]?.payload as Row | undefined;
              return <ChartTip active={active} label={row?.day} rows={row ? [
                ...(row.actual !== null ? [{ color: COLORS.trend, name: "Weigh-in", value: `${fmt(row.actual, 1)} kg` }] : []),
                ...(row.trend !== null ? [{ color: COLORS.trend, name: "Trend", value: `${fmt(row.trend, 2)} kg` }] : []),
                ...(row.projected != null && row.projectedBand ? [{ color: COLORS.trend, name: "Projection", value: `${fmt(row.projectedBand[0], 1)} to ${fmt(row.projectedBand[1], 1)} kg`, dashed: true }] : [])
              ] : []} />;
            }} />
            <Area dataKey="projectedBand" stroke="none" fill={COLORS.trend} fillOpacity={0.1} isAnimationActive={false} />
            <Line dataKey="projected" type="monotone" stroke={COLORS.trend} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
            <Scatter dataKey="actual" fill="var(--card)" stroke={COLORS.trend} strokeOpacity={0.7} strokeWidth={1.5} shape="circle" isAnimationActive={false} />
            <Line dataKey="trend" type="monotone" stroke={COLORS.trend} strokeWidth={2.5} connectNulls isAnimationActive={false}
              dot={(props: { cx?: number; cy?: number; index?: number; payload?: Row }) => {
                if (!lastTrend || props.payload?.day !== lastTrend.day || props.cx === undefined || props.cy === undefined) return <g key={props.index} />;
                return (
                  <g key={props.index}>
                    <circle cx={props.cx} cy={props.cy} r={4.5} fill={COLORS.trend} />
                    <text x={props.cx + 8} y={props.cy + 4} className="bs-figure" fontSize={14} fill="var(--foreground)">{fmt(lastTrend.trend, 1)}</text>
                  </g>
                );
              }} />
          </ComposedChart>
        </ChartContainer>
      </ChartSection>

      <ChartSection title="Eaten and burned" legend={[
        { color: COLORS.energy, label: "Eaten, complete day", area: true }, { color: COLORS.energy, label: "Not complete", hatch: true },
        { color: COLORS.burn, label: "Expenditure and range" }, { color: "var(--muted-foreground)", label: "Target", dashed: true }
      ]}>
        <ChartContainer config={{}} className="aspect-auto h-64 w-full sm:h-72" initialDimension={{ width: 760, height: 288 }} role="img" aria-label="Logged calories per day and the model's expenditure">
          <ComposedChart data={rows} margin={{ top: 12, left: 0, right: 44, bottom: 0 }} barCategoryGap="18%">
            <defs>
              <pattern id="bs-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="5" stroke={COLORS.energy} strokeWidth="2" strokeOpacity="0.75" />
              </pattern>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
            <XAxis dataKey="day" {...axis} tickMargin={8} minTickGap={36} tickFormatter={shortDay} />
            <YAxis {...axis} width={36} tickFormatter={(value: number) => (value >= 1000 ? `${fmt(value / 1000, value % 1000 ? 1 : 0)}k` : fmt(value))} />
            <Tooltip cursor={{ fill: "var(--muted)", fillOpacity: 0.5 }} content={({ active, payload }) => {
              const row = payload?.[0]?.payload as Row | undefined;
              return <ChartTip active={active} label={row?.day} rows={row ? [
                ...(row.kcal ? [{ color: COLORS.energy, name: row.eligible ? "Eaten" : `Eaten, ${row.status.toLowerCase()}`, value: `${fmt(row.kcal)} kcal` }] : []),
                ...(row.expenditure !== null ? [{ color: COLORS.burn, name: "Expenditure", value: `${fmt(row.expenditure)} kcal` }] : []),
                ...(row.band ? [{ color: COLORS.burn, name: "Range", value: `${fmt(row.band[0])} to ${fmt(row.band[1])}` }] : [])
              ] : []} />;
            }} />
            <Area dataKey="band" stroke="none" fill={COLORS.burn} fillOpacity={0.14} connectNulls isAnimationActive={false} />
            <Bar dataKey="eaten" stackId="kcal" fill={COLORS.energy} radius={[2, 2, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="partial" stackId="kcal" fill="url(#bs-hatch)" stroke={COLORS.energy} strokeOpacity={0.6} radius={[2, 2, 0, 0]} isAnimationActive={false} />
            <ReferenceLine y={data.settings.calorieTarget} stroke="var(--muted-foreground)" strokeDasharray="4 4" ifOverflow="extendDomain"
              label={{ value: "Target", position: "right", fill: "var(--muted-foreground)", fontSize: 11 }} />
            <Line dataKey="expenditure" type="monotone" stroke={COLORS.burn} strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />
          </ComposedChart>
        </ChartContainer>
      </ChartSection>
      <WeekSection review={data.review} target={data.settings.calorieTarget} today={data.today} />
      <FoodSection insights={data.insights} uncertain={data.uncertain} />
      {children}
    </BodyshopPage>
  );
}

function Readout({ label, value, unit, note, color }: { label: string; value: string; unit: string; note: string; color?: string }) {
  return (
    <div className="min-w-0 border-(--surface-border) px-1 py-3 odd:pr-4 even:border-l even:pl-4 lg:border-l lg:px-5 lg:first:border-l-0 lg:first:pl-0">
      <dt className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {color ? <span aria-hidden className="h-0.5 w-3" style={{ background: color }} /> : null}{label}
      </dt>
      <dd className="mt-1.5"><span className="bs-figure text-[2.5rem]">{value}</span> <span className="text-sm text-muted-foreground">{unit}</span></dd>
      <dd className="mt-1 text-xs text-muted-foreground">{note}</dd>
    </div>
  );
}

type LegendItem = { color: string; label: string; dot?: boolean; area?: boolean; hatch?: boolean; dashed?: boolean };

function ChartSection({ title, legend, note, children }: { title: string; legend: readonly LegendItem[]; note?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="mt-8">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {legend.map((item) => (
            <li key={item.label} className="flex items-center gap-1.5">
              <LegendMark item={item} />{item.label}
            </li>
          ))}
        </ul>
      </div>
      {children}
      {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
    </section>
  );
}

function LegendMark({ item }: { item: LegendItem }) {
  if (item.dot) return <span aria-hidden className="size-2 rounded-full border-[1.5px] bg-card" style={{ borderColor: item.color }} />;
  if (item.hatch) return <span aria-hidden className="size-2.5 rounded-[2px] border" style={{ borderColor: item.color, background: `repeating-linear-gradient(45deg, ${item.color} 0 1.5px, transparent 1.5px 4px)` }} />;
  if (item.area) return <span aria-hidden className="size-2.5 rounded-[2px]" style={{ background: item.color, opacity: item.label.startsWith("Goal") ? 0.35 : 1 }} />;
  return <span aria-hidden className="w-3.5 border-t-2" style={{ borderColor: item.color, borderStyle: item.dashed ? "dashed" : "solid" }} />;
}

/** The model's advice in sentence case: the workbook writes its verb in capitals. */
function sentenceCase(text: string): string {
  return text.replace(/^([A-Z]{2,})\b/, (word) => word[0] + word.slice(1).toLowerCase());
}

const DAY_STATE: Record<string, { color?: string; label: string }> = {
  Complete: { color: COLORS.good, label: "Complete" },
  Partial: { color: COLORS.burn, label: "Partial" },
  Unconfirmed: { color: COLORS.burn, label: "Unconfirmed" },
  "No log": { color: COLORS.flag, label: "No log" },
  "Not due": { label: "Not due" }
};

function WeekSection({ review, target, today }: { review: Data["review"]; target: number; today: string }) {
  return (
    <section aria-label="Weekly review" className="mt-10">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">This week</h2>
        <p className="text-sm text-muted-foreground">{review.completeText}{review.kcal !== null ? `, ${fmt(review.kcal)} kcal and ${fmt(review.protein)} g protein a complete day` : ""}</p>
      </div>
      <ol className="grid grid-cols-7 gap-1.5">
        {review.week.map((day) => {
          const state = DAY_STATE[day.status] ?? { label: day.status };
          return (
            <li key={day.day} className={`grid min-w-0 gap-1 rounded-md border-t-4 bg-card px-1.5 pt-1.5 pb-2 text-center ${day.day === today ? "outline-2 outline-foreground/60" : ""}`} style={{ borderTopColor: state.color ?? "var(--border)" }}>
              <span className="text-xs text-muted-foreground">{dayLabel(day.day).slice(0, 3)}</span>
              <span className="bs-figure truncate text-sm">{day.kcal ? day.kcal.replace(" kcal", "") : "–"}</span>
              <span className="sr-only">{state.label}</span>
            </li>
          );
        })}
      </ol>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {Object.values(DAY_STATE).filter((state) => state.color).map((state) => (
          <li key={state.label} className="flex items-center gap-1.5"><span aria-hidden className="h-1 w-3 rounded-full" style={{ background: state.color }} />{state.label}</li>
        ))}
      </ul>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-left text-sm tabular-nums">
          <caption className="sr-only">The last weeks. Averages use complete days only.</caption>
          <thead className="border-b-2 border-foreground/80 text-xs text-muted-foreground">
            <tr><th className="py-1.5 font-medium">Week of</th><th className="font-medium">Complete</th><th className="text-right font-medium">kcal</th><th className="text-right font-medium">vs target</th><th className="text-right font-medium">Protein</th><th className="text-right font-medium">Weight</th></tr>
          </thead>
          <tbody className="divide-y divide-(--surface-border)">
            {review.weeks.filter((week) => week.completeDays || week.weightDays).slice(0, 8).map((week) => (
              <tr key={week.start}>
                <td className="py-2">{shortDay(week.start)}</td>
                <td>{week.completeDays} of 7</td>
                <td className="bs-figure text-right text-base">{fmt(week.kcal)}</td>
                <td className="text-right" style={{ color: week.vsTarget !== null && week.vsTarget > 0 ? COLORS.flag : week.vsTarget !== null ? COLORS.good : undefined }}>{week.vsTarget === null ? "–" : signed(week.vsTarget)}</td>
                <td className="text-right">{week.protein === null ? "–" : `${fmt(week.protein)} g`}</td>
                <td className="text-right">{week.weight === null ? "–" : `${fmt(week.weight, 1)} kg`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">The target is {fmt(target)} kcal. Averages use complete days only.</p>
    </section>
  );
}

const MEAL_SHADES = [1, 0.78, 0.58, 0.4, 0.24];

function FoodSection({ insights, uncertain }: { insights: Data["insights"]; uncertain: Data["uncertain"] }) {
  if (!insights.entries) return null;
  const top = insights.topKcal.slice(0, 6);
  const most = top[0]?.kcal ?? 1;
  return (
    <section aria-label="Food" className="mt-10">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">Food, last 4 weeks</h2>
        <p className="text-sm text-muted-foreground">{fmt(insights.entries)} entries from {shortDay(insights.from)} to {shortDay(insights.to)}</p>
      </div>
      <div className="flex h-3 overflow-hidden rounded-sm" role="img" aria-label={insights.meals.map((meal) => `${meal.meal} ${fmt(meal.share * 100)} %`).join(", ")}>
        {insights.meals.filter((meal) => meal.share > 0).map((meal, index) => (
          <div key={meal.meal} style={{ width: `${meal.share * 100}%`, background: COLORS.energy, opacity: MEAL_SHADES[index] }} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {insights.meals.filter((meal) => meal.share > 0).map((meal, index) => (
          <li key={meal.meal} className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-[2px]" style={{ background: COLORS.energy, opacity: MEAL_SHADES[index] }} />
            {meal.meal} <span className="text-muted-foreground">{fmt(meal.share * 100)} %, {fmt(meal.proteinPer100Kcal, 1)} g protein per 100 kcal</span>
          </li>
        ))}
      </ul>
      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-2">
        <div>
          <h3 className="font-semibold">Most calories</h3>
          <ol className="mt-2 grid gap-2">
            {top.map((food) => (
              <li key={food.food} className="grid gap-1">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">{food.food}</span>
                  <span className="shrink-0 text-xs text-muted-foreground"><span className="bs-figure text-sm text-foreground">{fmt(food.kcal)}</span> kcal, {food.occurrences}×</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${(food.kcal / most) * 100}%`, background: COLORS.energy }} /></div>
              </li>
            ))}
          </ol>
        </div>
        {uncertain.length ? (
          <div>
            <h3 className="font-semibold">Least certain</h3>
            <p className="text-xs text-muted-foreground">Foods that add the most to the day ranges. A better label or a saved food narrows them most.</p>
            <ol className="mt-2 divide-y divide-(--surface-border)">
              {uncertain.slice(0, 6).map((food) => (
                <li key={food.food} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
                  <span className="min-w-0 truncate">{food.food}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">±<span className="bs-figure text-sm text-foreground">{fmt(food.halfRangeKcal)}</span> kcal over {food.entries} {food.entries === 1 ? "entry" : "entries"}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
    </section>
  );
}

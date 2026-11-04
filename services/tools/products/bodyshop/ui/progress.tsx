import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { Segmented } from "../../../platform/ui/components/segmented.js";
import { ChartContainer } from "../../../platform/ui/components/ui/chart.js";
import type { getBodyshopProgress } from "../server-functions.js";
import { BodyshopPage, ChartTip, COLORS, dayLabel, fmt, MEAL_COLORS, shortDay, signed } from "./kit.js";

type Data = Awaited<ReturnType<typeof getBodyshopProgress>>;
type Row = Data["rows"][number] & { band: [number, number] | null; eaten: number | null; partial: number | null; projected?: number | null; projectedBand?: [number, number] | null };

const SPANS = [["30", "30 days"], ["90", "90 days"], ["all", "All"]] as const;

/** What each model state means for the numbers, in words, with its color. */
const STATES: Record<string, { color: string; text: string }> = {
  Updating: { color: COLORS.burn, text: "The expenditure estimate is up to date." },
  Holding: { color: COLORS.energy, text: "The estimate keeps its last value with a wider range, because recent days miss logs or weights." },
  Stale: { color: COLORS.flag, text: "The estimate is too old to show. Log complete days and weigh in to update it." },
  Review: { color: COLORS.flag, text: "The estimate is hidden until the data is checked." },
  Building: { color: COLORS.quiet, text: "Bodyshop needs more complete days and weigh-ins before it can estimate expenditure." }
};

const axis = { tickLine: false, axisLine: false, tick: { fontSize: 11, fill: "var(--bs-quiet)" } } as const;

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

  const logged = rows.filter((row) => row.day <= (data.rows.at(-1)?.day ?? ""));
  const goal = { low: data.settings.goalLow, high: data.settings.goalHigh };
  const weights = rows.flatMap((row) => [row.actual, row.trend, ...(row.projectedBand ?? [])]).filter((value): value is number => value !== null);
  const [min, max] = weights.length ? [Math.min(...weights), Math.max(...weights)] : [goal.low, goal.high];
  const goalInView = goal.high >= min - 1.5 && goal.low <= max + 1.5;
  const domain: [number, number] = [Math.floor(Math.min(min, goalInView ? goal.low : min) - 0.5), Math.ceil(Math.max(max, goalInView ? goal.high : max) + 0.5)];
  const lastTrend = [...rows].reverse().find((row) => row.trend !== null);
  const p = data.projection;
  const state = STATES[s.state] ?? STATES.Building!;
  const toGoal = s.trend === null ? null : s.trend > goal.high ? s.trend - goal.high : s.trend < goal.low ? s.trend - goal.low : 0;

  return (
    <BodyshopPage title="Progress" actions={<Segmented label="Time span" options={SPANS} value={span} onValue={setSpan} />}>
      <section aria-label="Trend weight" className="mb-6">
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="bs-figure text-[4rem] leading-[0.85] sm:text-[4.75rem]">{s.trend === null ? "–" : fmt(s.trend, 1)}</span>
          <span className="text-[0.9375rem] font-medium">kg trend</span>
          {p.trendChange !== null ? <span className="bs-quiet text-[0.9375rem]"><span className="bs-figure text-[1.375rem] text-foreground">{signed(p.trendChange, 1)}</span> kg in 7 days</span> : null}
        </p>
        <p className="bs-quiet mt-3 max-w-[64ch] text-sm leading-relaxed">
          {s.latestWeight !== null && s.latestWeighIn ? `Last weighed ${fmt(s.latestWeight, 1)} kg ${dayLabel(s.latestWeighIn, data.today).toLowerCase()}.` : "No weigh-in yet."}
          {toGoal ? ` ${fmt(Math.abs(toGoal), 1)} kg ${toGoal > 0 ? "above" : "below"} the goal of ${fmt(goal.low)} to ${fmt(goal.high)} kg.` : toGoal === 0 ? " Inside the goal range." : ""}
          {p.mid !== null && p.low !== null && p.high !== null ? ` At this rate, about ${fmt(p.mid, 1)} kg in ${data.settings.projectionHorizonWeeks} weeks (${fmt(p.low, 1)} to ${fmt(p.high, 1)}).` : ""}
        </p>
      </section>

      <ChartSection title="Weight" legend={[{ color: COLORS.trend, label: "Trend" }, { color: COLORS.trend, label: "Weigh-in", dot: true }, ...(p.path.length ? [{ color: COLORS.trend, label: "Projection", dashed: true }] : []), ...(goalInView ? [{ color: COLORS.burn, label: "Goal", area: true }] : [])]}>
        <ChartContainer config={{}} className="aspect-auto h-72 w-full sm:h-[22rem]" initialDimension={{ width: 760, height: 352 }} role="img" aria-label="Daily weigh-ins and the smoothed trend weight in kg">
          <ComposedChart data={rows} margin={{ top: 12, left: 0, right: 44, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--bs-line)" />
            {goalInView ? <ReferenceArea y1={goal.low} y2={goal.high} fill={COLORS.burn} fillOpacity={0.12} stroke="none" ifOverflow="hidden" /> : null}
            <XAxis dataKey="day" {...axis} tickMargin={8} minTickGap={36} tickFormatter={shortDay} />
            <YAxis {...axis} domain={domain} width={36} allowDecimals={false} tickFormatter={(value: number) => fmt(value)} />
            <Tooltip cursor={{ stroke: "var(--bs-quiet)", strokeDasharray: "3 3" }} content={({ active, payload }) => {
              const row = payload?.[0]?.payload as Row | undefined;
              return <ChartTip active={active} label={row?.day} rows={row ? [
                ...(row.actual !== null ? [{ color: COLORS.trend, name: "Weigh-in", value: `${fmt(row.actual, 1)} kg` }] : []),
                ...(row.trend !== null ? [{ color: COLORS.trend, name: "Trend", value: `${fmt(row.trend, 2)} kg` }] : []),
                ...(row.projected != null && row.projectedBand ? [{ color: COLORS.trend, name: "Projection", value: `${fmt(row.projectedBand[0], 1)} to ${fmt(row.projectedBand[1], 1)} kg`, dashed: true }] : [])
              ] : []} />;
            }} />
            <Area dataKey="projectedBand" stroke="none" fill={COLORS.trend} fillOpacity={0.08} isAnimationActive={false} />
            <Line dataKey="projected" type="monotone" stroke={COLORS.trend} strokeOpacity={0.7} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
            <Scatter dataKey="actual" fill="var(--background)" stroke={COLORS.trend} strokeOpacity={0.55} strokeWidth={1.5} shape="circle" isAnimationActive={false} />
            <Line dataKey="trend" type="monotone" stroke={COLORS.trend} strokeWidth={3} connectNulls isAnimationActive={false}
              dot={(props: { cx?: number; cy?: number; index?: number; payload?: Row }) => {
                if (!lastTrend || props.payload?.day !== lastTrend.day || props.cx === undefined || props.cy === undefined) return <g key={props.index} />;
                return (
                  <g key={props.index}>
                    <circle cx={props.cx} cy={props.cy} r={5} fill={COLORS.trend} stroke="var(--background)" strokeWidth={2} />
                    <text x={props.cx + 9} y={props.cy - 9} className="bs-figure" fontSize={15} fill="var(--foreground)">{fmt(lastTrend.trend, 1)}</text>
                  </g>
                );
              }} />
          </ComposedChart>
        </ChartContainer>
      </ChartSection>

      <dl className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-5 border-t border-(--bs-line) pt-5 sm:grid-cols-3">
        <Readout label="Burned a day" color={COLORS.burn} value={s.tdeeMid === null ? "–" : fmt(s.tdeeMid)} unit="kcal"
          note={s.tdeeLow !== null && s.tdeeHigh !== null ? `Likely ${fmt(s.tdeeLow)} to ${fmt(s.tdeeHigh)}${data.steps.resting !== null ? `. At rest about ${fmt(data.steps.resting)}.` : "."}` : "Not enough data yet."} />
        <Readout label="Eaten a day, last 7 days" color={COLORS.energy} value={s.recentIntake === null ? "–" : fmt(s.recentIntake)} unit="kcal"
          note={`Mean of ${s.recentCompleteDays} complete ${s.recentCompleteDays === 1 ? "day" : "days"}.`} />
        <Readout label="Balance" value={s.balanceMid === null ? "–" : signed(s.balanceMid)} unit={s.balanceMid === null ? "" : "kcal"}
          note={s.weeklyChangeLow !== null && s.weeklyChangeHigh !== null ? `${signed(s.weeklyChangeLow, 2)} to ${signed(s.weeklyChangeHigh, 2)} kg a week.` : "Shows while the estimate is up to date."} />
      </dl>

      <div className="mt-5 grid max-w-[72ch] gap-2 text-sm leading-relaxed">
        <p>
          <span aria-hidden className="mr-2 inline-block size-2 -translate-y-px rounded-full" style={{ background: state.color }} />
          {state.text} <span className="bs-quiet">The last {s.windowDays} days have {s.completeDays} complete logs and {s.weightDays} weigh-in days. Ranges are scenarios, not confidence intervals.</span>
        </p>
        {data.energy.decision ? <p className="bs-quiet">{sentenceCase(data.energy.decision)}</p> : null}
      </div>

      <ChartSection title="Eaten and burned" legend={[
        { color: COLORS.energy, label: "Eaten, complete day", area: true }, { color: COLORS.energy, label: "Not complete", hatch: true },
        { color: COLORS.burn, label: "Burned, with range" }, { color: COLORS.quiet, label: "Target", dashed: true }
      ]}>
        <ChartContainer config={{}} className="aspect-auto h-64 w-full sm:h-72" initialDimension={{ width: 760, height: 288 }} role="img" aria-label="Logged calories per day and the model's expenditure">
          <ComposedChart data={logged} margin={{ top: 12, left: 0, right: 44, bottom: 0 }} barCategoryGap="22%">
            <defs>
              <pattern id="bs-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="5" stroke={COLORS.energy} strokeWidth="2" strokeOpacity="0.8" />
              </pattern>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--bs-line)" />
            <XAxis dataKey="day" {...axis} tickMargin={8} minTickGap={36} tickFormatter={shortDay} />
            <YAxis {...axis} width={36} tickFormatter={(value: number) => (value >= 1000 ? `${fmt(value / 1000, value % 1000 ? 1 : 0)}k` : fmt(value))} />
            <Tooltip cursor={{ fill: "var(--muted)", fillOpacity: 0.6 }} content={({ active, payload }) => {
              const row = payload?.[0]?.payload as Row | undefined;
              return <ChartTip active={active} label={row?.day} rows={row ? [
                ...(row.kcal ? [{ color: COLORS.energy, name: row.eligible ? "Eaten" : `Eaten, ${row.status.toLowerCase()}`, value: `${fmt(row.kcal)} kcal` }] : []),
                ...(row.expenditure !== null ? [{ color: COLORS.burn, name: "Burned", value: `${fmt(row.expenditure)} kcal` }] : []),
                ...(row.band ? [{ color: COLORS.burn, name: "Likely", value: `${fmt(row.band[0])} to ${fmt(row.band[1])}` }] : [])
              ] : []} />;
            }} />
            <Area dataKey="band" stroke="none" fill={COLORS.burn} fillOpacity={0.14} connectNulls isAnimationActive={false} />
            <Bar dataKey="eaten" stackId="kcal" fill={COLORS.energy} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="partial" stackId="kcal" fill="url(#bs-hatch)" stroke={COLORS.energy} strokeOpacity={0.7} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <ReferenceLine y={data.settings.calorieTarget} stroke="var(--bs-quiet)" strokeDasharray="4 4" ifOverflow="extendDomain"
              label={{ value: "Target", position: "right", fill: "var(--bs-quiet)", fontSize: 11 }} />
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
    <div className="min-w-0">
      <dt className="bs-quiet flex items-center gap-2 text-[0.8125rem]">
        {color ? <span aria-hidden className="h-[3px] w-3.5 rounded-full" style={{ background: color }} /> : null}{label}
      </dt>
      <dd className="mt-1.5"><span className="bs-figure text-[2.25rem]">{value}</span> <span className="bs-quiet text-sm">{unit}</span></dd>
      <dd className="bs-quiet mt-1 text-[0.8125rem] leading-snug">{note}</dd>
    </div>
  );
}

type LegendItem = { color: string; label: string; dot?: boolean; area?: boolean; hatch?: boolean; dashed?: boolean };

function ChartSection({ title, legend, children }: { title: string; legend: readonly LegendItem[]; children: ReactNode }) {
  return (
    <section aria-label={title} className="mt-10 first:mt-0">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1.5">
        <h2 className="bs-title text-[1.25rem]">{title}</h2>
        <ul className="bs-quiet flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {legend.map((item) => (
            <li key={item.label} className="flex items-center gap-1.5">
              <LegendMark item={item} />{item.label}
            </li>
          ))}
        </ul>
      </div>
      {children}
    </section>
  );
}

function LegendMark({ item }: { item: LegendItem }) {
  if (item.dot) return <span aria-hidden className="size-2 rounded-full border-[1.5px]" style={{ borderColor: item.color }} />;
  if (item.hatch) return <span aria-hidden className="size-2.5 rounded-[2px] border" style={{ borderColor: item.color, background: `repeating-linear-gradient(45deg, ${item.color} 0 1.5px, transparent 1.5px 4px)` }} />;
  if (item.area) return <span aria-hidden className="size-2.5 rounded-[2px]" style={{ background: item.color, opacity: item.label === "Goal" ? 0.4 : 1 }} />;
  return <span aria-hidden className="w-3.5 border-t-2" style={{ borderColor: item.color, borderStyle: item.dashed ? "dashed" : "solid" }} />;
}

/** The model's advice in sentence case: the workbook writes its verb in capitals. */
function sentenceCase(text: string): string {
  return text.replace(/^([A-Z]{2,})\b/, (word) => word[0] + word.slice(1).toLowerCase());
}

/** How each day of the week is drawn: a solid bar for a complete day, a hatched bar for a partial one. */
const DAY_STATE: Record<string, { mark: "solid" | "hatch" | "flag" | "none"; label: string }> = {
  Complete: { mark: "solid", label: "Complete" },
  Partial: { mark: "hatch", label: "Partial" },
  Unconfirmed: { mark: "hatch", label: "Unconfirmed" },
  "No log": { mark: "flag", label: "No log" },
  "Not due": { mark: "none", label: "Not due" }
};

function DayMark({ mark, className }: { mark: "solid" | "hatch" | "flag" | "none"; className?: string }) {
  const style = mark === "solid" ? { background: COLORS.energy } : mark === "flag" ? { background: COLORS.flag } : mark === "none" ? { background: "var(--bs-line)" } : undefined;
  return <span aria-hidden className={`block h-1 rounded-full ${mark === "hatch" ? "bs-hatch" : ""} ${className ?? ""}`} style={style} />;
}

function WeekSection({ review, target, today }: { review: Data["review"]; target: number; today: string }) {
  return (
    <section aria-label="Weekly review" className="mt-12">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="bs-title text-[1.25rem]">This week</h2>
        <p className="bs-quiet text-sm">{review.completeText}{review.kcal !== null ? `, ${fmt(review.kcal)} kcal and ${fmt(review.protein)} g protein a complete day` : ""}</p>
      </div>
      <ol className="grid grid-cols-7 gap-1.5 sm:gap-3">
        {review.week.map((day) => {
          const open = day.day === today && day.status === "No log";
          const state = open ? { mark: "none" as const, label: "Open" } : DAY_STATE[day.status] ?? { mark: "none" as const, label: day.status };
          return (
            <li key={day.day} className={`grid min-w-0 gap-1.5 rounded-xl px-1 py-2 text-center ${day.day === today ? "bg-muted" : ""}`}>
              <span className="bs-quiet text-xs">{dayLabel(day.day).slice(0, 3)}</span>
              <span className="bs-figure truncate text-[1.0625rem]">{day.kcal ? day.kcal.replace(" kcal", "") : "–"}</span>
              <DayMark mark={state.mark} className="mx-auto w-3/4" />
              <span className="sr-only">{state.label}</span>
            </li>
          );
        })}
      </ol>
      <ul className="bs-quiet mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {(["Complete", "Partial", "No log"] as const).map((label) => (
          <li key={label} className="flex items-center gap-1.5"><DayMark mark={DAY_STATE[label]!.mark} className="w-3.5" />{label}</li>
        ))}
      </ul>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">The last weeks. Averages use complete days only.</caption>
          <thead className="bs-quiet border-b border-(--bs-line) text-xs">
            <tr><th className="py-2 font-medium">Week</th><th className="font-medium">Complete</th><th className="text-right font-medium">kcal a day</th><th className="text-right font-medium">To target</th><th className="text-right font-medium">Protein</th><th className="text-right font-medium">Weight</th></tr>
          </thead>
          <tbody className="divide-y divide-(--bs-line)">
            {review.weeks.filter((week) => week.completeDays || week.weightDays).slice(0, 8).map((week) => (
              <tr key={week.start}>
                <td className="py-2.5">{shortDay(week.start)}</td>
                <td className="bs-quiet">{week.completeDays} of 7</td>
                <td className="bs-figure text-right text-base">{fmt(week.kcal)}</td>
                <td className="bs-figure text-right text-base" style={{ color: week.vsTarget !== null && week.vsTarget > 0 ? COLORS.flag : week.vsTarget !== null ? COLORS.burn : undefined }}>{week.vsTarget === null ? "–" : signed(week.vsTarget)}</td>
                <td className="bs-figure text-right text-base">{week.protein === null ? "–" : `${fmt(week.protein)} g`}</td>
                <td className="bs-figure text-right text-base">{week.weight === null ? "–" : `${fmt(week.weight, 1)} kg`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="bs-quiet mt-2 text-xs">The target is {fmt(target)} kcal. Averages use complete days only.</p>
    </section>
  );
}

function FoodSection({ insights, uncertain }: { insights: Data["insights"]; uncertain: Data["uncertain"] }) {
  if (!insights.entries) return null;
  const top = insights.topKcal.slice(0, 6);
  const most = top[0]?.kcal ?? 1;
  const meals = insights.meals.filter((meal) => meal.share > 0);
  return (
    <section aria-label="Food" className="mt-12">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="bs-title text-[1.25rem]">Food, last 4 weeks</h2>
        <p className="bs-quiet text-sm">{fmt(insights.entries)} entries from {shortDay(insights.from)} to {shortDay(insights.to)}</p>
      </div>
      <div className="flex h-4 gap-0.5 overflow-hidden rounded-[5px]" role="img" aria-label={meals.map((meal) => `${meal.meal} ${fmt(meal.share * 100)} %`).join(", ")}>
        {meals.map((meal) => <div key={meal.meal} style={{ width: `${meal.share * 100}%`, background: MEAL_COLORS[meal.meal] }} />)}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        {meals.map((meal) => (
          <li key={meal.meal} className="min-w-0">
            <span className="flex items-center gap-2"><span aria-hidden className="size-2.5 rounded-[2px]" style={{ background: MEAL_COLORS[meal.meal] }} />{meal.meal}<span className="bs-figure ml-auto text-base">{fmt(meal.share * 100)} %</span></span>
            <span className="bs-quiet block pl-[1.125rem] text-xs">{fmt(meal.proteinPer100Kcal, 1)} g protein per 100 kcal</span>
          </li>
        ))}
      </ul>
      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-2">
        <div>
          <h3 className="bs-title text-[1.0625rem]">Most calories</h3>
          <ol className="mt-3 grid gap-3">
            {top.map((food) => (
              <li key={food.food} className="grid gap-1.5">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">{food.food}</span>
                  <span className="bs-quiet shrink-0 text-xs"><span className="bs-figure text-[0.9375rem] text-foreground">{fmt(food.kcal)}</span> kcal in {food.occurrences} {food.occurrences === 1 ? "entry" : "entries"}</span>
                </div>
                <div className="h-1.5 rounded-full bg-(--bs-line)"><div className="h-full rounded-full" style={{ width: `${(food.kcal / most) * 100}%`, background: COLORS.energy }} /></div>
              </li>
            ))}
          </ol>
        </div>
        {uncertain.length ? (
          <div>
            <h3 className="bs-title text-[1.0625rem]">Least certain</h3>
            <p className="bs-quiet mt-1 text-[0.8125rem]">These foods widen the day ranges most. A label or a saved food narrows them.</p>
            <ol className="mt-2 divide-y divide-(--bs-line)">
              {uncertain.slice(0, 6).map((food) => (
                <li key={food.food} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 truncate">{food.food}</span>
                  <span className="bs-quiet shrink-0 text-xs">±<span className="bs-figure text-[0.9375rem] text-foreground">{fmt(food.halfRangeKcal)}</span> kcal in {food.entries} {food.entries === 1 ? "entry" : "entries"}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
    </section>
  );
}

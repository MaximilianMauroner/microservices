import { Link } from "@tanstack/react-router";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, SearchIcon } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { Segmented } from "../../../platform/ui/components/segmented.js";
import { Button } from "../../../platform/ui/components/ui/button.js";
import { Input } from "../../../platform/ui/components/ui/input.js";
import { Textarea } from "../../../platform/ui/components/ui/textarea.js";
import { cn } from "../../../platform/ui/lib/utils.js";
import { type DayStatus, MEALS, type Meal } from "../domain.js";
import type { getBodyshopDay } from "../server-functions.js";
import { COLORS, DayBudget, dayLabel, Field, fmt, MEAL_COLORS, numberOrNull, percent, Sheet, shiftDay, statusReason, useBodyshopAction } from "./kit.js";

type Data = Awaited<ReturnType<typeof getBodyshopDay>>;
type Entry = Data["entries"][number];
type Food = Data["foods"][number];
type Template = Data["templates"][number];

/** The meal that fits the time of day, for a new entry on today's page. */
function mealNow(): Meal {
  const hour = new Date().getHours();
  return hour < 4 ? "Snack" : hour < 11 ? "Breakfast" : hour < 15 ? "Lunch" : hour < 18 ? "Snack" : "Dinner";
}

export function TodayPage({ data }: { data: Data }) {
  const [adding, setAdding] = useState<Meal>();
  const [editing, setEditing] = useState<Entry>();
  const [template, setTemplate] = useState<Template>();
  const [checkIn, setCheckIn] = useState(false);
  const summary = data.summary;
  const isToday = data.day === data.today;
  const meals = MEALS.map((meal) => ({ meal, kcal: data.entries.filter((entry) => entry.meal === meal).reduce((sum, entry) => sum + (entry.nutrients.kcal ?? 0), 0) }));
  return (
    <>
      <header className="mb-6 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="bs-title text-[1.75rem]">{dayLabel(data.day, data.today)}</h1>
          <p className="bs-quiet mt-1 text-sm">{isToday ? dayLabel(data.day) : <Link to="/bodyshop" search={{}} className="underline decoration-(--bs-line) underline-offset-4 hover:text-foreground">Back to today</Link>}</p>
        </div>
        <nav aria-label="Days" className="flex shrink-0 gap-1">
          <Link to="/bodyshop" search={{ day: shiftDay(data.day, -1) }} aria-label="Day before" className="grid size-11 place-items-center rounded-full border border-(--bs-line) hover:bg-muted"><ChevronLeftIcon className="size-5" /></Link>
          <Link to="/bodyshop" search={{ day: shiftDay(data.day, 1) }} aria-label="Next day" disabled={data.day >= data.today} className="grid size-11 place-items-center rounded-full border border-(--bs-line) hover:bg-muted aria-disabled:pointer-events-none aria-disabled:opacity-30"><ChevronRightIcon className="size-5" /></Link>
        </nav>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start lg:gap-14">
        <div className="grid gap-8 lg:sticky lg:top-6">
          <DayBudget totals={summary ?? { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }} low={summary?.low ?? { kcal: null }} high={summary?.high ?? { kcal: null }}
            targets={data.targets} known={!summary || summary.check === "Ready"} meals={meals} />
          <div className="hidden lg:block"><DayPanel data={data} onCheckIn={() => setCheckIn(true)} /></div>
        </div>

        <div className="min-w-0">
          {data.templates.length ? (
            <section aria-label="Usual meals" className="-mx-3 mb-5 flex gap-2 overflow-x-auto px-3 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:px-0">
              {data.templates.map((one) => (
                <button key={one.name} type="button" onClick={() => setTemplate(one)}
                  className="flex h-10 shrink-0 items-center gap-2 rounded-full border border-(--bs-line) pr-4 pl-1.5 text-sm font-medium hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                  <span aria-hidden className="grid size-7 place-items-center rounded-full" style={{ background: MEAL_COLORS[one.meal], color: "var(--bs-on-energy)" }}><PlusIcon className="size-4" /></span>
                  {one.name}
                </button>
              ))}
            </section>
          ) : null}
          <MealList entries={data.entries} meals={meals} onAdd={setAdding} onEdit={setEditing} />
          <div className="mt-8 lg:hidden"><DayPanel data={data} onCheckIn={() => setCheckIn(true)} /></div>
        </div>
      </div>

      <AddSheet key={`${adding ?? "closed"}-${data.day}`} meal={adding} foods={data.foods} day={data.day} onClose={() => setAdding(undefined)} />
      {editing ? <EditSheet key={editing.id} entry={editing} foods={data.foods} onClose={() => setEditing(undefined)} /> : null}
      {template ? <TemplateSheet key={template.name} template={template} foods={data.foods} day={data.day} onClose={() => setTemplate(undefined)} /> : null}
      <CheckInSheet key={`${data.day}-${checkIn}`} open={checkIn} data={data} onClose={() => setCheckIn(false)} />
      {isToday ? (
        <button type="button" aria-label="Add food" onClick={() => setAdding(mealNow())}
          className="fixed right-4 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-30 grid size-15 place-items-center rounded-full shadow-[0_6px_24px_rgb(0_0_0/35%)] focus-visible:ring-4 focus-visible:ring-ring/60 focus-visible:outline-none md:hidden"
          style={{ background: COLORS.energy, color: "var(--bs-on-energy)" }}>
          <PlusIcon className="size-7" strokeWidth={2.5} />
        </button>
      ) : null}
    </>
  );
}

/** The day's food by meal. Each meal carries the shade it has on the day bar. */
function MealList({ entries, meals, onAdd, onEdit }: { entries: readonly Entry[]; meals: readonly { meal: Meal; kcal: number }[]; onAdd: (meal: Meal) => void; onEdit: (entry: Entry) => void }) {
  return (
    <div className="grid gap-2">
      {meals.map(({ meal, kcal }) => {
        const own = entries.filter((entry) => entry.meal === meal);
        if (!own.length && meal === "Other") return null;
        return (
          <section key={meal} aria-label={meal} className="border-t border-(--bs-line) pt-1 pb-2">
            <header className="flex items-center justify-between gap-2">
              <h2 className="bs-title flex items-center gap-2.5 py-2.5 text-[1.0625rem]">
                <span aria-hidden className="size-3 rounded-[3px]" style={{ background: MEAL_COLORS[meal] }} />{meal}
              </h2>
              <div className="flex items-center gap-1">
                {own.length ? <span className="bs-figure text-[1.25rem]">{fmt(kcal)}</span> : null}
                <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={`Add to ${meal.toLowerCase()}`} onClick={() => onAdd(meal)}><PlusIcon className="size-5" /></Button>
              </div>
            </header>
            {own.length ? (
              <ul>
                {own.map((entry) => (
                  <li key={entry.id}>
                    <button type="button" onClick={() => onEdit(entry)} className="-mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                      <span className="min-w-0 pl-[1.375rem]">
                        <span className="block truncate text-[0.9375rem]">{entry.food}</span>
                        <span className="bs-quiet block text-[0.8125rem]">
                          {fmt(entry.amount, entry.amount !== null && entry.amount % 1 ? 1 : 0)} {entry.unit}<span aria-hidden className="mx-1.5">/</span>{fmt(entry.nutrients.protein)} g protein
                        </span>
                        {entry.check !== "Ready" ? <span className="block text-[0.8125rem]" style={{ color: COLORS.flag }}>{entry.check}</span> : null}
                      </span>
                      <span className="bs-figure shrink-0 text-[1.0625rem]">{fmt(entry.nutrients.kcal)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

const STATUS_OPTIONS = [["auto", "Automatic"], ["Complete", "Complete"], ["Partial", "Partial"]] as const;

/** Weight and whether the day's log is complete, with the way into the check-in. */
function DayPanel({ data, onCheckIn }: { data: Data; onCheckIn: () => void }) {
  const { run, pending } = useBodyshopAction();
  const [kg, setKg] = useState("");
  const mean = data.weights.length ? data.weights.reduce((sum, one) => sum + one.kg, 0) / data.weights.length : null;
  const override = data.checkIn?.override ?? null;
  const status = data.summary?.status ?? "Unknown";
  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = numberOrNull(kg);
    if (value === null) return;
    if (await run({ type: "weight.log", day: data.day, kg: value }, "Weight logged")) setKg("");
  }
  return (
    <section aria-label="Weight and log status" className="bs-panel grid gap-5 p-4">
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="bs-title text-[1.0625rem]">Weight</h2>
          {mean !== null ? <p><span className="bs-figure text-[2rem]">{fmt(mean, 1)}</span> <span className="bs-quiet text-sm">kg</span></p> : <p className="bs-quiet text-sm">Not weighed</p>}
        </div>
        <form onSubmit={submit} className="mt-3 flex gap-2">
          <Input inputMode="decimal" placeholder="Weight in kg" aria-label="Weight in kg" value={kg} onChange={(event) => setKg(event.target.value)} className="h-11" />
          <Button type="submit" className="h-11 px-5" disabled={pending || numberOrNull(kg) === null}>Log</Button>
        </form>
        {data.weights.length > 1 || (data.weights.length && data.weights[0]!.time) ? (
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Weigh-ins of the day">
            {data.weights.map((one) => (
              <li key={one.id}>
                <button type="button" disabled={pending} onClick={() => void run({ type: "remove", kind: "weight", id: one.id }, "Weight removed")} className="bs-quiet rounded-full border border-(--bs-line) px-2.5 py-1 text-xs hover:text-foreground" aria-label={`Remove ${fmt(one.kg, 1)} kg`}>
                  {one.time ? `${one.time}, ` : ""}{fmt(one.kg, 1)} kg ×
                </button>
              </li>
            ))}
          </ul>
        ) : data.weights.length ? (
          <button type="button" disabled={pending} onClick={() => void run({ type: "remove", kind: "weight", id: data.weights[0]!.id }, "Weight removed")} className="bs-quiet mt-2 text-xs underline decoration-(--bs-line) underline-offset-4 hover:text-foreground">Remove this weight</button>
        ) : null}
      </div>
      <div className="grid gap-2.5 border-t border-(--bs-line) pt-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="bs-title text-[1.0625rem]">Food log</h2>
          <span className="text-sm font-medium" style={{ color: status === "Complete" ? undefined : COLORS.quiet }}>{status === "Complete" ? "Complete" : status === "Unknown" ? "Not complete" : status}</span>
        </div>
        <div className={cn(pending && "opacity-60")}>
          <Segmented label="Food log status" options={STATUS_OPTIONS} value={override ?? "auto"}
            onValue={(value) => void run({ type: "day.update", day: data.day, override: value === "auto" ? null : value as DayStatus }, "Day updated")} />
        </div>
        <p className="bs-quiet text-[0.8125rem] leading-snug">{statusReason(data.summary?.basis, status)} Only complete days count for the expenditure model.</p>
      </div>
      <Button variant="outline" className="h-11" onClick={onCheckIn}>Check in: training, sleep, hunger</Button>
    </section>
  );
}

const RANGES = [["0.1", "±10 %"], ["0.25", "±25 %"], ["0.5", "±50 %"]] as const;

function AddSheet({ meal: start, foods, day, onClose }: { meal: Meal | undefined; foods: readonly Food[]; day: string; onClose: () => void }) {
  const { run, pending } = useBodyshopAction();
  const [meal, setMeal] = useState<Meal>(start ?? "Snack");
  const [query, setQuery] = useState("");
  const [food, setFood] = useState<Food>();
  const [amount, setAmount] = useState("");
  const [packages, setPackages] = useState(false);
  const [estimate, setEstimate] = useState(false);
  const [values, setValues] = useState({ unit: "portion", kcal: "", protein: "", carbs: "", fat: "", fiber: "", range: "0.25" as (typeof RANGES)[number][0] });
  const matches = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return foods.filter((one) => words.every((word) => `${one.name} ${one.brand}`.toLowerCase().includes(word))).slice(0, 30);
  }, [foods, query]);
  const count = numberOrNull(amount);
  const grams = food && count !== null ? (packages && food.fullSize ? count * food.fullSize.amount : count) : null;
  const kcal = food && grams !== null && food.kcal !== null ? (food.kcal * grams) / food.amount : null;

  async function logSaved() {
    if (!food || count === null) return;
    const result = await run({ type: "food.log", day, items: [{ food: food.id, meal, amount: count, unit: packages ? food.container.split("/")[0]!.trim() || "full" : food.unit }] }, `${food.name} logged`);
    if (result) onClose();
  }
  async function logEstimate() {
    const kcalValue = numberOrNull(values.kcal);
    if (!query.trim() || kcalValue === null) return;
    const result = await run({
      type: "food.log", day, items: [{
        food: query.trim(), meal, amount: numberOrNull(amount) ?? 1, unit: values.unit.trim() || "portion", range: Number(values.range), fiberRange: Number(values.range),
        nutrients: { kcal: kcalValue, protein: numberOrNull(values.protein), carbs: numberOrNull(values.carbs), fat: numberOrNull(values.fat), fiber: numberOrNull(values.fiber) }
      }]
    }, `${query.trim()} logged`);
    if (result) onClose();
  }

  const footer = food ? (
    <Button onClick={() => void logSaved()} disabled={pending || count === null || count <= 0}>Log {kcal !== null ? `${fmt(kcal)} kcal` : ""}</Button>
  ) : estimate ? (
    <Button onClick={() => void logEstimate()} disabled={pending || !query.trim() || numberOrNull(values.kcal) === null}>Log estimate</Button>
  ) : undefined;

  return (
    <Sheet open={start !== undefined} onOpenChange={(open) => { if (!open) onClose(); }} title={`Add to ${meal.toLowerCase()}`} footer={footer}>
      <div className="grid gap-4">
        <Segmented label="Meal" options={MEALS.map((one) => [one, one] as const)} value={meal} onValue={setMeal} />
        {food ? (
          <div className="grid gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{food.name}</p>
                <p className="text-xs text-muted-foreground">{fmt(food.kcal)} kcal per {fmt(food.amount)} {food.unit}{food.brand ? ` · ${food.brand}` : ""}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setFood(undefined); setAmount(""); setPackages(false); }}>Change</Button>
            </div>
            <Field label={packages ? `Number of ${food.container || "packages"}` : `Amount in ${food.unit}`} hint={packages && food.fullSize ? `One is ${fmt(food.fullSize.amount)} ${food.fullSize.unit}.` : undefined}>
              <Input autoFocus inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className="h-11 text-lg" />
            </Field>
            {food.fullSize && food.fullSize.unit === food.unit && food.fullSize.amount !== food.amount ? (
              <Segmented label="Amount as" options={[["amount", food.unit], ["packages", `Full ${food.container.split("/")[0]!.trim() || "package"}`]] as const} value={packages ? "packages" : "amount"} onValue={(value) => setPackages(value === "packages")} />
            ) : null}
          </div>
        ) : estimate ? (
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground">An estimate for a food that is not saved. Give the values for the amount you ate.</p>
            <Field label="Food"><Input value={query} onChange={(event) => setQuery(event.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount"><Input inputMode="decimal" value={amount} placeholder="1" onChange={(event) => setAmount(event.target.value)} /></Field>
              <Field label="Unit"><Input value={values.unit} onChange={(event) => setValues({ ...values, unit: event.target.value })} /></Field>
              <Field label="Calories"><Input inputMode="decimal" value={values.kcal} onChange={(event) => setValues({ ...values, kcal: event.target.value })} /></Field>
              <Field label="Protein (g)"><Input inputMode="decimal" value={values.protein} onChange={(event) => setValues({ ...values, protein: event.target.value })} /></Field>
              <Field label="Carbs (g)"><Input inputMode="decimal" value={values.carbs} onChange={(event) => setValues({ ...values, carbs: event.target.value })} /></Field>
              <Field label="Fat (g)"><Input inputMode="decimal" value={values.fat} onChange={(event) => setValues({ ...values, fat: event.target.value })} /></Field>
              <Field label="Fiber (g)"><Input inputMode="decimal" value={values.fiber} onChange={(event) => setValues({ ...values, fiber: event.target.value })} /></Field>
            </div>
            <div className="grid gap-1.5 text-sm">
              <span className="font-medium">How sure are you?</span>
              <Segmented label="Range" options={RANGES} value={values.range} onValue={(range) => setValues({ ...values, range })} />
            </div>
          </div>
        ) : (
          <div className="grid gap-2">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input type="search" autoComplete="off" placeholder="Search saved foods" aria-label="Search saved foods" value={query} onChange={(event) => setQuery(event.target.value)} className="h-10 pl-9" />
            </div>
            <ul className="divide-y divide-(--surface-border)">
              {matches.map((one) => (
                <li key={one.id}>
                  <button type="button" className="flex w-full items-center justify-between gap-3 py-2.5 text-left" onClick={() => { setFood(one); setAmount(one.unit === "piece" || one.amount === 1 ? "1" : ""); }}>
                    <span className="min-w-0 truncate">{one.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{fmt(one.kcal)} / {fmt(one.amount)} {one.unit}</span>
                  </button>
                </li>
              ))}
            </ul>
            {!matches.length ? <p className="py-2 text-sm text-muted-foreground">No saved food matches.</p> : null}
            <Button variant="outline" onClick={() => setEstimate(true)}>{query.trim() ? `Estimate "${query.trim()}"` : "Log an estimate"}</Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function EditSheet({ entry, foods, onClose }: { entry: Entry; foods: readonly Food[]; onClose: () => void }) {
  const { run, pending } = useBodyshopAction();
  const [amount, setAmount] = useState(entry.amount === null ? "" : String(entry.amount));
  const [meal, setMeal] = useState<Meal>(entry.meal);
  const [notes, setNotes] = useState(entry.notes);
  const saved = foods.some((food) => food.name === entry.food);
  async function save() {
    const value = numberOrNull(amount);
    const result = await run({ type: "entry.correct", id: entry.id, meal, notes, ...(value !== null && value !== entry.amount ? { amount: value } : {}) }, "Entry corrected");
    if (result) onClose();
  }
  async function remove() {
    if (await run({ type: "remove", kind: "entry", id: entry.id }, `${entry.food} removed`)) onClose();
  }
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }} title={entry.food}
      description={`${entry.source}${entry.reference ? ` · ${fmt(entry.reference.nutrients.kcal)} kcal per ${fmt(entry.reference.amount, entry.reference.amount % 1 ? 1 : 0)} ${entry.reference.unit}` : ""}`}
      footer={<><Button variant="outline" onClick={() => void remove()} disabled={pending}>Remove</Button><Button onClick={() => void save()} disabled={pending}>Save</Button></>}>
      <div className="grid gap-4">
        <Field label={`Amount in ${entry.unit}`}><Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className="h-11 text-lg" /></Field>
        <Segmented label="Meal" options={MEALS.map((one) => [one, one] as const)} value={meal} onValue={setMeal} />
        <dl className="grid grid-cols-3 gap-2 text-sm">
          {([["Calories", entry.nutrients.kcal, ""], ["Protein", entry.nutrients.protein, " g"], ["Carbs", entry.nutrients.carbs, " g"], ["Fat", entry.nutrients.fat, " g"], ["Fiber", entry.nutrients.fiber, " g"], ["Range", null, ""]] as const).map(([label, value, unit]) => (
            <div key={label} className="rounded-lg bg-muted/50 px-2.5 py-1.5">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="tabular-nums">{label === "Range" ? percent(entry.range) : `${fmt(value, label === "Calories" ? 0 : 1)}${unit}`}</dd>
            </div>
          ))}
        </dl>
        {entry.check !== "Ready" ? <p className="text-sm" style={{ color: COLORS.flag }}>Check: {entry.check}. The day's ranges stay unknown until this is fixed.</p> : null}
        <Field label="Notes"><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} /></Field>
        {!saved && entry.source === "Saved food" ? <p className="text-xs text-muted-foreground">The saved food changed its name or was removed. The entry keeps the nutrition it was logged with.</p> : null}
      </div>
    </Sheet>
  );
}

function TemplateSheet({ template, foods, day, onClose }: { template: Template; foods: readonly Food[]; day: string; onClose: () => void }) {
  const { run, pending } = useBodyshopAction();
  const [parts, setParts] = useState(template.parts.map((part) => ({ ...part, eaten: true, food: part.saved ? part.part : "", amount: String(part.amount) })));
  const missing = parts.some((part) => part.eaten && !part.food);
  async function log() {
    const result = await run({
      type: "meal.log", day, template: template.name,
      skip: parts.filter((part) => !part.eaten).map((part) => part.part),
      choices: parts.filter((part) => part.eaten).map((part) => {
        const changed = part.food !== part.part;
        const amount = numberOrNull(part.amount);
        return { part: part.part, ...(changed ? { food: part.food } : {}), ...(amount !== null && (changed || amount !== template.parts.find((one) => one.part === part.part)?.amount) ? { amount } : {}) };
      })
    }, `${template.name} logged`);
    if (result) onClose();
  }
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }} title={template.name} description={`${template.meal}. Untick what you did not eat.`}
      footer={<Button onClick={() => void log()} disabled={pending || missing || !parts.some((part) => part.eaten)}>Log meal</Button>}>
      <ul className="grid gap-3">
        {parts.map((part, index) => {
          const update = (change: Partial<typeof part>) => setParts(parts.map((one, at) => (at === index ? { ...one, ...change } : one)));
          const food = foods.find((one) => one.name === part.food);
          return (
            <li key={part.part} className={cn("grid gap-2 rounded-xl border border-(--surface-border) p-3", !part.eaten && "opacity-50")}>
              <label className="flex items-center gap-2 font-medium">
                <input type="checkbox" checked={part.eaten} onChange={(event) => update({ eaten: event.target.checked })} className="size-4" />
                {part.part}
              </label>
              {part.eaten ? (
                <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
                  {part.variable || !part.saved ? (
                    <select aria-label={`Food for ${part.part}`} value={part.food} onChange={(event) => { const next = foods.find((one) => one.name === event.target.value); update({ food: event.target.value, amount: next ? String(next.unit === "piece" ? 1 : next.amount) : part.amount }); }}
                      className="h-9 rounded-md border border-input bg-(--field) px-2 text-sm">
                      <option value="">Choose a food</option>
                      {foods.map((one) => <option key={one.id} value={one.name}>{one.name}</option>)}
                    </select>
                  ) : <span className="self-center text-sm text-muted-foreground">{food ? `${fmt(food.kcal)} kcal / ${fmt(food.amount)} ${food.unit}` : ""}</span>}
                  <Input aria-label={`Amount of ${part.part}`} inputMode="decimal" value={part.amount} onChange={(event) => update({ amount: event.target.value })} className="h-9" />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

function CheckInSheet({ open, data, onClose }: { open: boolean; data: Data; onClose: () => void }) {
  const { run, pending } = useBodyshopAction();
  const current = data.checkIn;
  const [form, setForm] = useState({
    training: current?.training ?? "", trainingNotes: current?.trainingNotes ?? "", steps: current?.steps === null || current?.steps === undefined ? "" : String(current.steps),
    hunger: current?.hunger ?? null, fatigue: current?.fatigue ?? null, recovery: current?.recovery ?? null,
    sleep: current?.sleep === null || current?.sleep === undefined ? "" : String(current.sleep), notes: current?.notes ?? ""
  });
  async function save() {
    const steps = numberOrNull(form.steps);
    const result = await run({
      type: "day.update", day: data.day, training: form.training, trainingNotes: form.trainingNotes, steps: steps === null ? null : Math.round(steps),
      hunger: form.hunger, fatigue: form.fatigue, recovery: form.recovery, sleep: numberOrNull(form.sleep), notes: form.notes
    }, "Check-in saved");
    if (result) onClose();
  }
  const scale = (label: string, key: "hunger" | "fatigue" | "recovery") => (
    <div className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <Segmented label={label} options={[["", "–"], ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"]] as const} value={form[key] === null ? "" : String(form[key]) as "1"}
        onValue={(value) => setForm({ ...form, [key]: value === "" ? null : Number(value) })} />
    </div>
  );
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }} title={`Check-in, ${dayLabel(data.day, data.today).toLowerCase()}`}
      footer={<Button onClick={() => void save()} disabled={pending}>Save check-in</Button>}>
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Training"><Input value={form.training} placeholder="Rest, gym, run" onChange={(event) => setForm({ ...form, training: event.target.value })} /></Field>
          <Field label="Steps"><Input inputMode="numeric" value={form.steps} onChange={(event) => setForm({ ...form, steps: event.target.value })} /></Field>
          <Field label="Sleep (h)"><Input inputMode="decimal" value={form.sleep} onChange={(event) => setForm({ ...form, sleep: event.target.value })} /></Field>
        </div>
        <Field label="Training notes"><Input value={form.trainingNotes} onChange={(event) => setForm({ ...form, trainingNotes: event.target.value })} /></Field>
        {scale("Hunger (1 low, 5 high)", "hunger")}
        {scale("Fatigue (1 low, 5 high)", "fatigue")}
        {scale("Recovery (1 poor, 5 good)", "recovery")}
        <Field label="Notes"><Textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field>
      </div>
    </Sheet>
  );
}

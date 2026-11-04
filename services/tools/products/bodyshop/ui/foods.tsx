import { PlusIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "../../../platform/ui/components/ui/button.js";
import { Input } from "../../../platform/ui/components/ui/input.js";
import { Textarea } from "../../../platform/ui/components/ui/textarea.js";
import type { SavedFood } from "../domain.js";
import { BodyshopPage, Field, fmt, numberOrNull, percent, Sheet, useBodyshopAction } from "./kit.js";

export function FoodsPage({ foods }: { foods: readonly SavedFood[] }) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<SavedFood | "new">();
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return foods.filter((food) => words.every((word) => `${food.name} ${food.brand}`.toLowerCase().includes(word)));
  }, [foods, query]);
  return (
    <BodyshopPage title="Saved foods" facts={`${foods.length} foods. An entry keeps the nutrition it was logged with, so a change here does not change past days.`}
      actions={<Button onClick={() => setEditing("new")}><PlusIcon aria-hidden />New food</Button>}>
      <div className="relative mb-4">
        <SearchIcon className="bs-quiet pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2" aria-hidden />
        <Input type="search" placeholder="Search foods" aria-label="Search foods" value={query} onChange={(event) => setQuery(event.target.value)} className="h-11 rounded-full pl-10" />
      </div>
      <ul className="bs-panel divide-y divide-(--bs-line) overflow-hidden">
        {shown.map((food) => (
          <li key={food.id}>
            <button type="button" onClick={() => setEditing(food)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none">
              <span className="min-w-0">
                <span className="block truncate text-[0.9375rem]">{food.name}</span>
                <span className="bs-quiet block truncate text-[0.8125rem]">{[food.brand, food.fullSize ? `1 ${food.container || "package"} is ${fmt(food.fullSize.amount)} ${food.fullSize.unit}` : ""].filter(Boolean).join(", ") || `${percent(food.range)} range`}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="bs-figure text-[1.125rem]">{fmt(food.nutrients.kcal)}</span><span className="bs-quiet text-xs"> kcal</span>
                <span className="bs-quiet block text-xs">per {fmt(food.amount)} {food.unit}</span>
              </span>
            </button>
          </li>
        ))}
        {!shown.length ? <li className="bs-quiet px-4 py-8 text-center text-sm">No saved food matches. Use New food to save it.</li> : null}
      </ul>
      {editing ? <FoodSheet key={editing === "new" ? "new" : editing.id} food={editing === "new" ? undefined : editing} initialName={editing === "new" ? query : ""} onClose={() => setEditing(undefined)} /> : null}
    </BodyshopPage>
  );
}

const text = (value: number | null | undefined) => (value === null || value === undefined ? "" : String(value));
const shareText = (value: number | null | undefined) => (value === null || value === undefined ? "" : String(Math.round(value * 1000) / 10));

function FoodSheet({ food, initialName, onClose }: { food: SavedFood | undefined; initialName: string; onClose: () => void }) {
  const { run, pending } = useBodyshopAction();
  const [form, setForm] = useState({
    name: food?.name ?? initialName, brand: food?.brand ?? "", amount: text(food?.amount ?? 100), unit: food?.unit ?? "g",
    kcal: text(food?.nutrients.kcal), protein: text(food?.nutrients.protein), carbs: text(food?.nutrients.carbs), fat: text(food?.nutrients.fat), fiber: text(food?.nutrients.fiber),
    range: shareText(food?.range), fiberRange: shareText(food?.fiberRange), container: food?.container ?? "", fullAmount: text(food?.fullSize?.amount), source: food?.source ?? "", notes: food?.notes ?? ""
  });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value });
  async function save() {
    const range = numberOrNull(form.range);
    const fiberRange = numberOrNull(form.fiberRange);
    const fullAmount = numberOrNull(form.fullAmount);
    const result = await run({
      type: "food.save", id: food?.id, name: form.name, brand: form.brand, amount: numberOrNull(form.amount) ?? undefined, unit: form.unit,
      nutrients: { kcal: numberOrNull(form.kcal) ?? undefined, protein: numberOrNull(form.protein), carbs: numberOrNull(form.carbs), fat: numberOrNull(form.fat), fiber: numberOrNull(form.fiber) },
      range: range === null ? null : range / 100, fiberRange: fiberRange === null ? null : fiberRange / 100,
      container: form.container, fullSize: fullAmount === null ? null : { amount: fullAmount, unit: form.unit }, source: form.source, notes: form.notes
    }, `${form.name} saved`);
    if (result) onClose();
  }
  async function remove() {
    if (food && await run({ type: "remove", kind: "food", id: food.id }, `${food.name} removed`)) onClose();
  }
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }} title={food ? food.name : "New food"}
      footer={<>{food ? <Button variant="outline" onClick={() => void remove()} disabled={pending}>Remove</Button> : null}<Button onClick={() => void save()} disabled={pending || !form.name.trim() || numberOrNull(form.kcal) === null}>Save</Button></>}>
      <div className="grid gap-3">
        <Field label="Name"><Input value={form.name} onChange={set("name")} /></Field>
        <Field label="Brand or description"><Input value={form.brand} onChange={set("brand")} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Values per"><Input inputMode="decimal" value={form.amount} onChange={set("amount")} /></Field>
          <Field label="Unit"><Input value={form.unit} onChange={set("unit")} placeholder="g, ml, piece" /></Field>
          <Field label="Calories"><Input inputMode="decimal" value={form.kcal} onChange={set("kcal")} /></Field>
          <Field label="Protein (g)"><Input inputMode="decimal" value={form.protein} onChange={set("protein")} /></Field>
          <Field label="Carbs (g)"><Input inputMode="decimal" value={form.carbs} onChange={set("carbs")} /></Field>
          <Field label="Fat (g)"><Input inputMode="decimal" value={form.fat} onChange={set("fat")} /></Field>
          <Field label="Fiber (g)"><Input inputMode="decimal" value={form.fiber} onChange={set("fiber")} /></Field>
          <Field label="Range ± %" hint="5 for a label, 25 for a guess."><Input inputMode="decimal" value={form.range} onChange={set("range")} /></Field>
          <Field label="Fiber range ± %"><Input inputMode="decimal" value={form.fiberRange} onChange={set("fiberRange")} /></Field>
          <Field label="Container word" hint="Such as pack or tub."><Input value={form.container} onChange={set("container")} /></Field>
          <Field label={`Full size in ${form.unit || "units"}`}><Input inputMode="decimal" value={form.fullAmount} onChange={set("fullAmount")} /></Field>
          <Field label="Source"><Input value={form.source} onChange={set("source")} placeholder="Label, website" /></Field>
        </div>
        <Field label="Notes"><Textarea rows={3} value={form.notes} onChange={set("notes")} /></Field>
      </div>
    </Sheet>
  );
}

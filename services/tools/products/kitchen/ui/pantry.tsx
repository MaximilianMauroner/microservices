import { PlusIcon, Trash2Icon, UtensilsIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../platform/ui/components/ui/button.js";
import { Input } from "../../../platform/ui/components/ui/input.js";
import { Label } from "../../../platform/ui/components/ui/label.js";
import { cn } from "../../../platform/ui/lib/utils.js";
import { addDays, formatAmount, type Ingredient, type Leftover, type StockItem, unitName } from "../domain.js";
import { byGroup, type Frame, GROUP_LIST, GroupDot, groupColor, GroupLabel, groupLabel, groupListStyle, KitchenEmpty, KitchenPage, KitchenSheet, SearchField, Stepper, tint, useByLabel, useKitchenAction } from "./kit.js";
import { type KitchenLanguage, useLanguage, useText } from "./language.js";

const en = {
  title: "At home",
  inStock: (count: number) => `${count} ${count === 1 ? "ingredient" : "ingredients"} in stock`,
  toUseFirst: (count: number) => `, ${count} ${count === 1 ? "leftover" : "leftovers"} to use first`,
  addLeftover: "Add leftover",
  addToStock: "Add to stock",
  useFirst: "Use first",
  servings: (count: number) => `${count} ${count === 1 ? "serving" : "servings"}`,
  ate: (name: string) => `Ate ${name}`,
  eatOne: "Ate 1 serving",
  throwAway: "Throw away",
  thrownAway: (name: string) => `${name} thrown away`,
  noLeftovers: "No leftovers. When you mark a meal cooked, you can keep the servings you did not eat.",
  stock: "Stock",
  nothingInStock: "Nothing in stock",
  checkItems: "Check items off the shopping list, or add what is already in your cupboards.",
  amountOf: (name: string) => `Amount of ${name}`,
  usedUpAria: (name: string) => `${name} is used up`,
  usedUpToast: (name: string) => `${name} used up`,
  updated: (name: string) => `${name} updated`,
  addStockTitle: "Add to stock",
  addStockDescription: "The amount adds to what is already at home.",
  findIngredient: "Find an ingredient",
  added: (amount: string, name: string) => `${amount} ${name} added`,
  addIngredientsFirst: "Add ingredients first, on the Ingredients page or inside a recipe.",
  addLeftoverTitle: "Add a leftover",
  keepIt: "Keep it",
  kept: (name: string) => `${name} kept`,
  whatIsLeft: "What is left",
  chiliPlaceholder: "Chili con Carne",
  servingsLabel: "Servings",
  goodForDays: "Good for days",
  days: "Days"
};

const TEXT: Record<KitchenLanguage, typeof en> = {
  en,
  de: {
    title: "Vorrat",
    inStock: (count: number) => (count === 1 ? "1 Zutat im Vorrat" : `${count} Zutaten im Vorrat`),
    toUseFirst: (count: number) => (count === 1 ? ", 1 Rest zuerst verbrauchen" : `, ${count} Reste zuerst verbrauchen`),
    addLeftover: "Rest hinzufügen",
    addToStock: "Zum Vorrat hinzufügen",
    useFirst: "Zuerst verbrauchen",
    servings: (count: number) => (count === 1 ? "1 Portion" : `${count} Portionen`),
    ate: (name: string) => `${name} gegessen`,
    eatOne: "1 Portion gegessen",
    throwAway: "Wegwerfen",
    thrownAway: (name: string) => `${name} weggeworfen`,
    noLeftovers: "Keine Reste. Wenn du eine Mahlzeit als gekocht markierst, kannst du die Portionen behalten, die du nicht gegessen hast.",
    stock: "Vorrat",
    nothingInStock: "Nichts im Vorrat",
    checkItems: "Hake Artikel auf der Einkaufsliste ab oder füge hinzu, was schon in deinen Schränken liegt.",
    amountOf: (name: string) => `Menge von ${name}`,
    usedUpAria: (name: string) => `${name} ist aufgebraucht`,
    usedUpToast: (name: string) => `${name} aufgebraucht`,
    updated: (name: string) => `${name} aktualisiert`,
    addStockTitle: "Zum Vorrat hinzufügen",
    addStockDescription: "Die Menge kommt zu dem dazu, was schon zu Hause ist.",
    findIngredient: "Zutat suchen",
    added: (amount: string, name: string) => `${amount} ${name} hinzugefügt`,
    addIngredientsFirst: "Füge zuerst Zutaten hinzu, auf der Seite Zutaten oder in einem Rezept.",
    addLeftoverTitle: "Rest hinzufügen",
    keepIt: "Aufbewahren",
    kept: (name: string) => `${name} aufbewahrt`,
    whatIsLeft: "Was übrig ist",
    chiliPlaceholder: "Chili con Carne",
    servingsLabel: "Portionen",
    goodForDays: "Haltbar für",
    days: "Tage"
  }
};

type PantryData = Frame & { stock: readonly StockItem[]; leftovers: readonly Leftover[]; ingredients: readonly Ingredient[] };

export function KitchenPantryPage(data: PantryData) {
  const { kitchen, stock, leftovers, today } = data;
  const language = useLanguage();
  const text = useText(TEXT);
  const { run, pending } = useKitchenAction(kitchen.id);
  const [adding, setAdding] = useState<"stock" | "leftover" | undefined>();
  const groups = byGroup(kitchen.groups, stock, (item) => item.section);

  return (
    <KitchenPage
      title={text.title}
      facts={`${text.inStock(stock.length)}${leftovers.length ? text.toUseFirst(leftovers.length) : ""}`}
      actions={(
        <>
          <Button variant="outline" onClick={() => setAdding("leftover")}><UtensilsIcon aria-hidden /> {text.addLeftover}</Button>
          <Button onClick={() => setAdding("stock")}><PlusIcon aria-hidden /> {text.addToStock}</Button>
        </>
      )}
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <section aria-labelledby="leftovers-title" className="grid content-start gap-2">
          <h2 id="leftovers-title" className="px-1 font-kitchen font-semibold tracking-tight text-lg leading-tight">{text.useFirst}</h2>
          {leftovers.length ? (
            <ul className="grid gap-2">
              {leftovers.map((leftover) => {
                const label = useByLabel(leftover.useBy, today, language);
                return (
                  <li key={leftover.id} className="rounded-2xl p-3.5" style={{ background: tint(label.urgent ? "var(--destructive)" : "var(--kitchen-home-ink)", 11) }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium break-words">{leftover.name}</p>
                        <p className={cn("text-xs", label.urgent ? "text-destructive" : "text-muted-foreground")}>{label.text}</p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">{text.servings(leftover.servings)}</span>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Button size="sm" variant="outline" disabled={pending}
                        onClick={() => run({ type: "leftover.eat", id: leftover.id, servings: Math.min(1, leftover.servings) }, { title: text.ate(leftover.name), undo: leftover.servings <= 1 ? { type: "leftover.add", name: leftover.name, servings: leftover.servings, useBy: leftover.useBy } : undefined })}>
                        {text.eatOne}
                      </Button>
                      <Button size="sm" variant="destructive-subtle" disabled={pending}
                        onClick={() => run({ type: "leftover.remove", id: leftover.id }, { title: text.thrownAway(leftover.name), undo: { type: "leftover.add", name: leftover.name, servings: leftover.servings, useBy: leftover.useBy } })}>
                        {text.throwAway}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : <p className="rounded-2xl border border-dashed border-[color:var(--surface-border)] px-4 py-6 text-sm text-muted-foreground">{text.noLeftovers}</p>}
        </section>
        <section aria-labelledby="stock-title" className="grid content-start gap-4">
          <h2 id="stock-title" className="sr-only">{text.stock}</h2>
          {groups.map(([section, items]) => (
            <div key={section} className="min-w-0">
              <h3 className="mb-2 font-kitchen font-semibold tracking-tight text-lg leading-tight">
                <GroupLabel color={groupColor(kitchen.groups, section)} count={items.length}>{groupLabel(section, language)}</GroupLabel>
              </h3>
              <ul className={GROUP_LIST} style={groupListStyle(groupColor(kitchen.groups, section))}>
                {items.map((item) => <StockRow key={item.ingredientId} item={item} run={run} pending={pending} />)}
              </ul>
            </div>
          ))}
          {!stock.length ? (
            <KitchenEmpty title={text.nothingInStock} body={text.checkItems} />
          ) : null}
        </section>
      </div>
      <AddStockSheet open={adding === "stock"} onClose={() => setAdding(undefined)} data={data} />
      <AddLeftoverSheet open={adding === "leftover"} onClose={() => setAdding(undefined)} data={data} />
    </KitchenPage>
  );
}

function StockRow({ item, run, pending }: { item: StockItem; run: ReturnType<typeof useKitchenAction>["run"]; pending: boolean }) {
  const language = useLanguage();
  const text = useText(TEXT);
  const [value, setValue] = useState(String(item.amount));
  const [last, setLast] = useState(item.amount);
  if (item.amount !== last) { setLast(item.amount); setValue(String(item.amount)); }
  const commit = () => {
    const amount = Number(value.replace(",", "."));
    if (!Number.isFinite(amount) || amount < 0) return setValue(String(item.amount));
    if (amount !== item.amount) void run({ type: "stock.set", ingredientId: item.ingredientId, amount }, { title: text.updated(item.ingredient), undo: { type: "stock.set", ingredientId: item.ingredientId, amount: item.amount } });
  };
  return (
    <li className="flex min-h-14 items-center gap-3 px-3 py-2 sm:px-4">
      <span className="min-w-0 flex-1 font-medium break-words">{item.ingredient}</span>
      <label className="flex items-center gap-1.5">
        <span className="sr-only">{text.amountOf(item.ingredient)}</span>
        <Input className="h-9 w-20 text-right tabular-nums" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)}
          onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }} />
        <span className="w-12 text-sm text-muted-foreground">{unitName(item.unit, language)}</span>
      </label>
      <Button size="icon-sm" variant="ghost" className="size-11 md:size-8" aria-label={text.usedUpAria(item.ingredient)} disabled={pending}
        onClick={() => run({ type: "stock.set", ingredientId: item.ingredientId, amount: 0 }, { title: text.usedUpToast(item.ingredient), undo: { type: "stock.set", ingredientId: item.ingredientId, amount: item.amount } })}>
        <Trash2Icon />
      </Button>
    </li>
  );
}

function AddStockSheet({ open, onClose, data }: { open: boolean; onClose: () => void; data: PantryData }) {
  const { run, pending } = useKitchenAction(data.kitchen.id);
  const language = useLanguage();
  const text = useText(TEXT);
  const [ingredientId, setIngredientId] = useState("");
  const [amount, setAmount] = useState("");
  const [query, setQuery] = useState("");
  const selected = data.ingredients.find((one) => one.id === ingredientId);
  const matches = byGroup(data.kitchen.groups, data.ingredients.filter((one) => one.name.toLowerCase().includes(query.trim().toLowerCase())), (one) => one.section)
    .flatMap(([, items]) => items).slice(0, 60);
  const close = () => { onClose(); setIngredientId(""); setAmount(""); setQuery(""); };
  return (
    <KitchenSheet open={open} onOpenChange={(next) => { if (!next) close(); }} title={text.addStockTitle} description={text.addStockDescription}
      footer={<Button size="lg" className="px-5" disabled={!selected || !(Number(amount.replace(",", ".")) > 0) || pending}
        onClick={async () => { if (selected && await run({ type: "stock.add", ingredientId: selected.id, amount: Number(amount.replace(",", ".")) }, { title: text.added(formatAmount(Number(amount.replace(",", ".")), selected.unit, language), selected.name) })) close(); }}>{text.addToStock}</Button>}>
      {data.ingredients.length ? (
        <div className="grid gap-4">
          <SearchField value={query} onValue={setQuery} label={text.findIngredient} inSheet>
          <div className="flex flex-wrap gap-1.5">
            {matches.map((one) => (
              <button key={one.id} type="button" aria-pressed={one.id === ingredientId} onClick={() => setIngredientId(one.id)}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-control-border bg-control px-3 text-sm aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground">
                <GroupDot groups={data.kitchen.groups} group={one.section} className="size-2" />
                {one.name}
              </button>
            ))}
          </div>
          </SearchField>
          {selected ? (
            <div className="grid gap-1.5">
              <Label htmlFor="stock-amount">{text.amountOf(selected.name)}</Label>
              <div className="flex items-center gap-2">
                <Input id="stock-amount" autoFocus className="h-10 w-32 tabular-nums" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
                <span className="text-sm text-muted-foreground">{unitName(selected.unit, language)}</span>
              </div>
            </div>
          ) : null}
        </div>
      ) : <p className="pb-2 text-sm text-muted-foreground">{text.addIngredientsFirst}</p>}
    </KitchenSheet>
  );
}

function AddLeftoverSheet({ open, onClose, data }: { open: boolean; onClose: () => void; data: PantryData }) {
  const { run, pending } = useKitchenAction(data.kitchen.id);
  const text = useText(TEXT);
  const [name, setName] = useState("");
  const [servings, setServings] = useState(2);
  const [days, setDays] = useState(3);
  const close = () => { onClose(); setName(""); setServings(2); setDays(3); };
  return (
    <KitchenSheet open={open} onOpenChange={(next) => { if (!next) close(); }} title={text.addLeftoverTitle}
      footer={<Button size="lg" className="px-5" disabled={!name.trim() || pending}
        onClick={async () => { if (await run({ type: "leftover.add", name, servings, useBy: addDays(data.today, days) }, { title: text.kept(name.trim()) })) close(); }}>{text.keepIt}</Button>}>
      <div className="grid gap-4 pb-2">
        <div className="grid gap-1.5">
          <Label htmlFor="leftover-name">{text.whatIsLeft}</Label>
          <Input id="leftover-name" className="h-10" value={name} onChange={(event) => setName(event.target.value)} placeholder={text.chiliPlaceholder} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3"><Label>{text.servingsLabel}</Label><Stepper label={text.servingsLabel} value={servings} onValue={setServings} /></div>
        <div className="flex flex-wrap items-center justify-between gap-3"><Label>{text.goodForDays}</Label><Stepper label={text.days} value={days} onValue={setDays} max={30} /></div>
      </div>
    </KitchenSheet>
  );
}

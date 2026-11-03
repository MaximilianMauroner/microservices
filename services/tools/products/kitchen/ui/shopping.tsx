import { useNavigate } from "@tanstack/react-router";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon, RepeatIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../platform/ui/components/ui/button.js";
import { Input } from "../../../platform/ui/components/ui/input.js";
import { cn } from "../../../platform/ui/lib/utils.js";
import { addDays, type ExtraItem, formatAmount, type Ingredient, type ShoppingLine } from "../domain.js";
import { byGroup, type Frame, GROUP_LIST, GroupDot, groupColor, GroupLabel, groupLabel, groupListStyle, ink, KitchenEmpty, KitchenPage, KitchenSheet, PlateRing, tint, useKitchenAction, weekLabel } from "./kit.js";
import { type KitchenLanguage, useLanguage, useText } from "./language.js";

const en = {
  title: "Shopping list",
  previousWeek: "Previous week",
  nextWeek: "Next week",
  addItem: "Add item",
  toBuy: (count: number) => (count === 1 ? "1 thing to buy" : `${count} things to buy`),
  nothingToBuy: "Nothing to buy",
  plannedFor: (count: number) => (count === 1 ? "for 1 planned meal" : `for ${count} planned meals`),
  groupsOnList: "Groups on the list",
  emptyTitle: "Your list is empty",
  emptyBody: "Plan meals for this week, and their ingredients show up here. Add anything else with Add item.",
  alsoBuy: "Also buy",
  everyWeek: "Every week",
  addEveryWeek: "Every week",
  addEveryWeekHint: "On, an item comes back every week, for snacks and other things you always buy.",
  stopEveryWeek: (name: string) => `Stop buying ${name} every week`,
  stopped: (name: string) => `${name} is no longer on every week's list`,
  notBought: (name: string) => `${name} back on the list`,
  bought: (name: string) => `${name} bought`,
  addedToHome: (amount: string, name: string) => `${amount} ${name} added to At home`,
  forRecipes: (recipes: string) => `For ${recipes}`,
  inStock: (amount: string) => `${amount} at home`,
  alreadyAtHome: (count: number) => (count === 1 ? "Already at home: 1 ingredient" : `Already at home: ${count} ingredients`),
  needs: (amount: string) => `needs ${amount}`,
  boughtAria: (name: string, amount?: string) => `Bought ${name}${amount ? `, ${amount}` : ""}`,
  addTitle: "Add to the shopping list",
  addDescription: "Tap what you need, or type anything else.",
  done: "Done",
  doneAdded: (count: number) => `Done (${count} added)`,
  itemPlaceholder: "Toilet paper, coffee, …",
  item: "Item",
  add: "Add",
  quickPicks: "Your ingredients appear here as quick picks once you add them."
};

const TEXT: Record<KitchenLanguage, typeof en> = {
  en,
  de: {
    title: "Einkaufsliste",
    previousWeek: "Vorherige Woche",
    nextWeek: "Nächste Woche",
    addItem: "Artikel hinzufügen",
    toBuy: (count: number) => `${count} Artikel zu kaufen`,
    nothingToBuy: "Nichts zu kaufen",
    plannedFor: (count: number) => (count === 1 ? "für 1 geplante Mahlzeit" : `für ${count} geplante Mahlzeiten`),
    groupsOnList: "Gruppen auf der Liste",
    emptyTitle: "Deine Liste ist leer",
    emptyBody: "Plane Mahlzeiten für diese Woche, dann erscheinen hier ihre Zutaten. Alles andere fügst du mit „Artikel hinzufügen“ hinzu.",
    alsoBuy: "Zusätzlich kaufen",
    everyWeek: "Jede Woche",
    addEveryWeek: "Jede Woche",
    addEveryWeekHint: "Eingeschaltet kommt ein Artikel jede Woche wieder, für Snacks und andere Dinge, die du immer kaufst.",
    stopEveryWeek: (name: string) => `${name} nicht mehr jede Woche kaufen`,
    stopped: (name: string) => `${name} ist nicht mehr auf der Wochenliste`,
    notBought: (name: string) => `${name} wieder auf der Liste`,
    bought: (name: string) => `${name} gekauft`,
    addedToHome: (amount: string, name: string) => `${amount} ${name} in den Vorrat gelegt`,
    forRecipes: (recipes: string) => `Für ${recipes}`,
    inStock: (amount: string) => `${amount} zu Hause`,
    alreadyAtHome: (count: number) => (count === 1 ? "Schon zu Hause: 1 Zutat" : `Schon zu Hause: ${count} Zutaten`),
    needs: (amount: string) => `braucht ${amount}`,
    boughtAria: (name: string, amount?: string) => `${name} gekauft${amount ? `, ${amount}` : ""}`,
    addTitle: "Zur Einkaufsliste hinzufügen",
    addDescription: "Tippe an, was du brauchst, oder schreib etwas anderes.",
    done: "Fertig",
    doneAdded: (count: number) => `Fertig (${count} hinzugefügt)`,
    itemPlaceholder: "Toilettenpapier, Kaffee, …",
    item: "Artikel",
    add: "Hinzufügen",
    quickPicks: "Deine Zutaten erscheinen hier als Schnellauswahl, sobald du sie hinzugefügt hast."
  }
};

type ShoppingData = Frame & { shopping: { start: string; lines: readonly ShoppingLine[]; extras: readonly ExtraItem[] }; plannedMeals: number; ingredients: readonly Ingredient[] };

export function KitchenShoppingPage(data: ShoppingData) {
  const { kitchen, shopping, today } = data;
  const navigate = useNavigate();
  const language = useLanguage();
  const text = useText(TEXT);
  const { run, pending } = useKitchenAction(kitchen.id);
  const [adding, setAdding] = useState(false);
  const toBuy = shopping.lines.filter((line) => line.toBuy > 0);
  const covered = shopping.lines.filter((line) => line.toBuy === 0);
  const groups = byGroup(kitchen.groups, toBuy, (line) => line.section);
  const once = shopping.extras.filter((extra) => !extra.everyWeek);
  const weekly = shopping.extras.filter((extra) => extra.everyWeek);
  const count = toBuy.length + once.length + weekly.filter((extra) => !extra.bought).length;
  const goWeek = (start: string) => void navigate({ to: "/kitchen/$kitchenId/shopping", params: { kitchenId: kitchen.id }, search: { week: start } });

  return (
    <KitchenPage
      title={text.title}
      facts={`${weekLabel(shopping.start, today, language)}. ${count ? text.toBuy(count) : text.nothingToBuy}${data.plannedMeals ? ` ${text.plannedFor(data.plannedMeals)}` : ""}.`}
      actions={(
        <>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="size-11 md:size-9" aria-label={text.previousWeek} onClick={() => goWeek(addDays(shopping.start, -7))}><ChevronLeftIcon /></Button>
            <Button variant="outline" size="icon" className="size-11 md:size-9" aria-label={text.nextWeek} onClick={() => goWeek(addDays(shopping.start, 7))}><ChevronRightIcon /></Button>
          </div>
          <Button onClick={() => setAdding(true)}><PlusIcon aria-hidden /> {text.addItem}</Button>
        </>
      )}
    >
      <div className="grid max-w-2xl gap-6">
        {groups.length ? (
          <nav aria-label={text.groupsOnList} className="flex items-center gap-4 rounded-2xl p-4" style={{ background: tint("var(--kitchen-shopping-ink)", 10) }}>
            <PlateRing groups={kitchen.groups} sections={toBuy.map((line) => line.section)} size={64} />
            <ul className="flex min-w-0 flex-wrap gap-x-1 gap-y-0.5">
              {groups.map(([section, lines]) => (
                <li key={section}>
                  <a href={`#${anchor(section)}`} style={{ color: ink(groupColor(kitchen.groups, section)) }} className="inline-flex h-11 items-center gap-1.5 rounded-full px-2 text-sm font-semibold hover:underline hover:underline-offset-4 md:h-8 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                    <GroupDot groups={kitchen.groups} group={section} />
                    {groupLabel(section, language)}
                    <span className="font-medium tabular-nums opacity-75">{lines.length}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        {!count && !covered.length ? (
          <KitchenEmpty title={text.emptyTitle} body={text.emptyBody} />
        ) : null}
        {weekly.length ? (
          <Group id="shopping-every-week" title={text.everyWeek} color="var(--kitchen-home-ink)" count={weekly.filter((extra) => !extra.bought).length}>
            {weekly.map((extra) => (
              <Row key={extra.id} name={extra.name} disabled={pending} color="var(--kitchen-home-ink)" done={extra.bought}
                onCheck={() => run({ type: "extra.mark", id: extra.id, week: shopping.start, bought: true }, { title: text.bought(extra.name), undo: { type: "extra.mark", id: extra.id, week: shopping.start, bought: false } })}
                onUncheck={() => run({ type: "extra.mark", id: extra.id, week: shopping.start, bought: false }, { title: text.notBought(extra.name) })} />
            ))}
          </Group>
        ) : null}
        {once.length ? (
          <Group id="shopping-extras" title={text.alsoBuy} color="var(--kitchen-shopping-ink)">
            {once.map((extra) => (
              <Row key={extra.id} name={extra.name} disabled={pending} color="var(--kitchen-shopping-ink)"
                onCheck={() => run({ type: "extra.remove", id: extra.id }, { title: text.bought(extra.name), undo: { type: "extra.add", name: extra.name } })} />
            ))}
          </Group>
        ) : null}
        {groups.map(([section, lines]) => (
          <Group key={section} id={anchor(section)} title={groupLabel(section, language)} color={groupColor(kitchen.groups, section)} count={lines.length}>
            {lines.map((line) => (
              <Row
                key={line.ingredientId}
                color={groupColor(kitchen.groups, section)}
                name={line.ingredient}
                amount={formatAmount(line.toBuy, line.unit, language)}
                detail={`${text.forRecipes(line.recipes.join(", "))}${line.inStock ? `. ${text.inStock(formatAmount(line.inStock, line.unit, language))}` : ""}`}
                disabled={pending}
                onCheck={() => run(
                  { type: "stock.add", ingredientId: line.ingredientId, amount: line.toBuy },
                  { title: text.addedToHome(formatAmount(line.toBuy, line.unit, language), line.ingredient), undo: { type: "stock.set", ingredientId: line.ingredientId, amount: line.inStock } }
                )}
              />
            ))}
          </Group>
        ))}
        {covered.length ? (
          <details className="group rounded-2xl border border-[color:var(--surface-border)] bg-card/50 px-4 py-3">
            <summary className="cursor-pointer list-none text-sm font-medium text-muted-foreground marker:hidden">
              {text.alreadyAtHome(covered.length)}
            </summary>
            <ul className="mt-2 grid gap-1">
              {covered.map((line) => (
                <li key={line.ingredientId} className="flex justify-between gap-3 py-1 text-sm">
                  <span className="flex items-center gap-2"><GroupDot groups={kitchen.groups} group={line.section} />{line.ingredient}</span>
                  <span className="text-muted-foreground tabular-nums">{text.needs(formatAmount(line.needed, line.unit, language))}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      <AddSheet open={adding} onClose={() => setAdding(false)} data={data} />
    </KitchenPage>
  );
}

function anchor(section: string) {
  return `group-${section.toLowerCase().replace(/[^a-z0-9äöüß]+/g, "-")}`;
}

function Group({ id, title, color, count, children }: { id: string; title: string; color: string; count?: number; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="min-w-0 scroll-mt-20">
      <h2 id={id} className="mb-2 font-kitchen font-semibold tracking-tight text-lg leading-tight">
        <GroupLabel color={color} count={count}>{title}</GroupLabel>
      </h2>
      <ul className={GROUP_LIST} style={groupListStyle(color)}>{children}</ul>
    </section>
  );
}

/**
 * One item to tick off. Without `onUncheck`, a ticked row stays ticked until the list drops it.
 * With it, as for every-week items, a second tap unticks it.
 */
function Row({ name, amount, detail, color, onCheck, onUncheck, done = false, disabled }: {
  name: string; amount?: string; detail?: string; color: string; done?: boolean; disabled: boolean;
  onCheck: () => Promise<unknown>; onUncheck?: () => Promise<unknown>;
}) {
  const text = useText(TEXT);
  const [optimistic, setOptimistic] = useState<boolean>();
  const checked = optimistic ?? done;
  async function toggle() {
    const next = !checked;
    setOptimistic(next);
    const ok = await (next ? onCheck() : onUncheck?.());
    setOptimistic(ok ? next : undefined);
  }
  return (
    <li>
      <button
        type="button"
        disabled={disabled || (checked && !onUncheck)}
        aria-pressed={onUncheck ? checked : undefined}
        onClick={() => void toggle()}
        className="flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-background/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset sm:px-4"
        aria-label={text.boughtAria(name, amount)}
      >
        <span className={cn(
          "grid size-7 shrink-0 place-items-center rounded-full border-2 transition-colors",
          checked ? "text-background" : "bg-card"
        )} style={{ borderColor: color, background: checked ? color : undefined }} aria-hidden>
          {checked ? <CheckIcon className="size-4" strokeWidth={3} /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block font-medium break-words", checked && "text-muted-foreground line-through")}>{name}</span>
          {detail ? <span className="line-clamp-2 text-xs text-muted-foreground">{detail}</span> : null}
        </span>
        {amount ? <span className="shrink-0 text-sm font-semibold tabular-nums" style={{ color: ink(color) }}>{amount}</span> : null}
      </button>
    </li>
  );
}

function AddSheet({ open, onClose, data }: { open: boolean; onClose: () => void; data: ShoppingData }) {
  const { run, pending } = useKitchenAction(data.kitchen.id);
  const language = useLanguage();
  const text = useText(TEXT);
  const [name, setName] = useState("");
  const [added, setAdded] = useState<string[]>([]);
  const [everyWeek, setEveryWeek] = useState(false);
  const weekly = data.shopping.extras.filter((extra) => extra.everyWeek);
  const onList = new Set([...data.shopping.extras.map((extra) => extra.name.toLowerCase()), ...added.map((item) => item.toLowerCase())]);
  const groups = byGroup(data.kitchen.groups, data.ingredients, (ingredient) => ingredient.section);

  async function add(item: string) {
    const trimmed = item.trim();
    if (!trimmed || onList.has(trimmed.toLowerCase())) return;
    if (await run({ type: "extra.add", name: trimmed, everyWeek })) setAdded((current) => [...current, trimmed]);
  }

  return (
    <KitchenSheet
      open={open}
      onOpenChange={(next) => { if (!next) { onClose(); setAdded([]); setName(""); } }}
      title={text.addTitle}
      description={text.addDescription}
      footer={<Button size="lg" className="px-5" onClick={() => { onClose(); setAdded([]); }}>{added.length ? text.doneAdded(added.length) : text.done}</Button>}
    >
      <form className="mb-2 flex gap-2" onSubmit={(event) => { event.preventDefault(); void add(name).then(() => setName("")); }}>
        <Input className="h-10" placeholder={text.itemPlaceholder} value={name} onChange={(event) => setName(event.target.value)} aria-label={text.item} />
        <Button type="submit" variant="outline" className="h-10" disabled={!name.trim() || pending}>{text.add}</Button>
      </form>
      <div className="mb-4 flex items-start gap-3">
        <button type="button" aria-pressed={everyWeek} onClick={() => setEveryWeek((on) => !on)}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-control-border bg-control px-3 text-sm font-medium hover:border-control-border-hover aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground">
          <RepeatIcon className="size-4" aria-hidden /> {text.addEveryWeek}
        </button>
        <p className="pt-1 text-xs text-muted-foreground">{text.addEveryWeekHint}</p>
      </div>
      {weekly.length ? (
        <section className="mb-4">
          <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><RepeatIcon className="size-3.5" aria-hidden />{text.everyWeek}</h3>
          <ul className="flex flex-wrap gap-1.5">
            {weekly.map((extra) => (
              <li key={extra.id} className="inline-flex h-9 items-center gap-1 rounded-full border border-control-border pr-1 pl-3 text-sm">
                {extra.name}
                <button type="button" disabled={pending} aria-label={text.stopEveryWeek(extra.name)}
                  onClick={() => void run({ type: "extra.remove", id: extra.id }, { title: text.stopped(extra.name), undo: { type: "extra.add", name: extra.name, everyWeek: true } })}
                  className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
                  <XIcon className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="grid gap-4">
        {groups.map(([section, ingredients]) => (
          <section key={section}>
            <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><GroupDot groups={data.kitchen.groups} group={section} className="size-2" />{groupLabel(section, language)}</h3>
            <div className="flex flex-wrap gap-1.5">
              {ingredients.map((ingredient) => {
                const isOn = onList.has(ingredient.name.toLowerCase());
                return (
                  <button
                    key={ingredient.id}
                    type="button"
                    aria-pressed={isOn}
                    disabled={isOn || pending}
                    onClick={() => void add(ingredient.name)}
                    className="inline-flex h-9 items-center gap-1 rounded-full border border-control-border bg-control px-3 text-sm hover:border-control-border-hover aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                  >
                    {isOn ? <CheckIcon className="size-3.5" aria-hidden /> : null}
                    {ingredient.name}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
        {!data.ingredients.length ? <p className="text-sm text-muted-foreground">{text.quickPicks}</p> : null}
      </div>
    </KitchenSheet>
  );
}

"use client";

import { useState, type ComponentType } from "react";
import {
  ArrowLeftRight,
  Bus,
  ChartNoAxesCombined,
  ChevronDown,
  CircleDollarSign,
  CircleHelp,
  Clapperboard,
  Ellipsis,
  Gift,
  GraduationCap,
  HeartPulse,
  House,
  Landmark,
  Plane,
  ReceiptText,
  Repeat2,
  Mountain,
  Laptop,
  Scissors,
  ShoppingBag,
  ShoppingBasket,
  SlidersHorizontal,
  Utensils,
  WalletCards,
} from "lucide-react";
import { Button } from "../src/components/ui/button.js";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../src/components/ui/command.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../src/components/ui/popover.js";
import type { MoneyCategory } from "./money-enums.js";

type CategoryMeta = Readonly<{
  label: string;
  icon: ComponentType<{ className?: string }>;
  colors: string;
  searchTerms: string;
}>;

const CATEGORY_META = {
  housing: { label: "Housing", icon: House, colors: "bg-rose-500/15 text-rose-700 dark:text-rose-300", searchTerms: "rent mortgage utilities electricity gas water home apartment property maintenance repair cleaning" },
  groceries: { label: "Groceries", icon: ShoppingBasket, colors: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", searchTerms: "supermarket grocery food market household bakery butcher convenience supplies" },
  dining: { label: "Dining", icon: Utensils, colors: "bg-orange-500/15 text-orange-700 dark:text-orange-300", searchTerms: "restaurant cafe coffee takeaway lunch dinner bar delivery" },
  transport: { label: "Transport", icon: Bus, colors: "bg-sky-500/15 text-sky-700 dark:text-sky-300", searchTerms: "train bus metro subway tram taxi uber rideshare fuel petrol parking car vehicle bicycle bike commute toll rental" },
  shopping: { label: "Shopping", icon: ShoppingBag, colors: "bg-purple-500/15 text-purple-700 dark:text-purple-300", searchTerms: "retail clothes clothing shoes electronics purchase store books hardware furniture appliance" },
  health: { label: "Health", icon: HeartPulse, colors: "bg-teal-500/15 text-teal-700 dark:text-teal-300", searchTerms: "doctor pharmacy medicine dentist hospital gym fitness insurance optical glasses therapy counseling vet veterinary pet" },
  personal_care: { label: "Personal care", icon: Scissors, colors: "bg-pink-500/15 text-pink-700 dark:text-pink-300", searchTerms: "barber hairdresser haircut salon beauty spa nails cosmetics makeup skincare grooming massage tattoo piercing laundry dry cleaning" },
  travel: { label: "Travel", icon: Plane, colors: "bg-blue-500/15 text-blue-700 dark:text-blue-300", searchTerms: "flight airline hotel hostel resort holiday vacation booking airbnb luggage trip cruise visa tourism" },
  subscriptions: { label: "Subscriptions", icon: Repeat2, colors: "bg-violet-500/15 text-violet-700 dark:text-violet-300", searchTerms: "recurring membership software streaming plan monthly internet mobile phone cloud hosting newspaper magazine" },
  software: { label: "Software", icon: Laptop, colors: "bg-blue-500/15 text-blue-700 dark:text-blue-300", searchTerms: "app ai artificial intelligence software saas cloud hosting developer tools license digital service" },
  education: { label: "Education", icon: GraduationCap, colors: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300", searchTerms: "school university course books tuition training learning childcare daycare exam certification" },
  entertainment: { label: "Entertainment", icon: Clapperboard, colors: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300", searchTerms: "cinema movie concert game gaming theatre music event sports museum festival ticket hobby" },
  recreation: { label: "Recreation", icon: Mountain, colors: "bg-lime-500/15 text-lime-700 dark:text-lime-300", searchTerms: "outdoors hiking skiing cable car gondola lift leisure excursion activity" },
  gifts: { label: "Gifts", icon: Gift, colors: "bg-pink-500/15 text-pink-700 dark:text-pink-300", searchTerms: "present donation charity flowers birthday wedding" },
  taxes: { label: "Taxes", icon: Landmark, colors: "bg-red-500/15 text-red-700 dark:text-red-300", searchTerms: "tax vat government duty revenue" },
  fees: { label: "Fees", icon: ReceiptText, colors: "bg-amber-500/15 text-amber-700 dark:text-amber-300", searchTerms: "fee charge commission penalty service cost legal lawyer accountant accounting postage shipping professional" },
  cash: { label: "Cash", icon: WalletCards, colors: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300", searchTerms: "atm withdrawal deposit notes coins" },
  investments: { label: "Investments", icon: ChartNoAxesCombined, colors: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300", searchTerms: "stock shares etf crypto trade broker portfolio dividend" },
  income: { label: "Income", icon: CircleDollarSign, colors: "bg-green-500/15 text-green-700 dark:text-green-300", searchTerms: "salary wage paycheck interest bonus earnings" },
  transfer: { label: "Transfer", icon: ArrowLeftRight, colors: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300", searchTerms: "move money bank transfer topup top up internal send receive" },
  adjustment: { label: "Adjustment", icon: SlidersHorizontal, colors: "bg-slate-500/15 text-slate-700 dark:text-slate-300", searchTerms: "correction balance migration reconciliation" },
  other: { label: "Other", icon: Ellipsis, colors: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300", searchTerms: "misc miscellaneous general" },
  uncategorized: { label: "Uncategorized", icon: CircleHelp, colors: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300", searchTerms: "unknown needs category review unclassified" },
} as const satisfies Record<MoneyCategory, CategoryMeta>;

const CATEGORY_GROUPS = [
  { label: "Living", categories: ["housing", "groceries", "dining", "transport", "shopping", "health", "personal_care"] },
  { label: "Lifestyle", categories: ["travel", "subscriptions", "software", "education", "entertainment", "recreation", "gifts"] },
  { label: "Money", categories: ["income", "transfer", "cash", "investments", "taxes", "fees", "adjustment"] },
  { label: "Other", categories: ["other", "uncategorized"] },
] as const satisfies readonly Readonly<{ label: string; categories: readonly MoneyCategory[] }>[];

export function moneyCategoryLabel(category: MoneyCategory) {
  return CATEGORY_META[category].label;
}

export function moneyCategorySearchValue(category: MoneyCategory) {
  const meta = CATEGORY_META[category];
  return `${meta.label} ${category} ${meta.searchTerms}`;
}

export function MoneyCategoryPicker({
  value,
  onValue,
  disabled = false,
  mobile = false,
  compact = false,
  suggestions = [],
  ariaLabel,
}: Readonly<{
  value: MoneyCategory;
  onValue: (value: MoneyCategory) => void;
  disabled?: boolean;
  mobile?: boolean;
  /** A small chip for ledger rows instead of a full-width field. */
  compact?: boolean;
  /** Offered first, for example the categories earlier rows with the same description used. */
  suggestions?: readonly MoneyCategory[];
  ariaLabel?: string;
}>) {
  const [open, setOpen] = useState(false);
  const selected = CATEGORY_META[value];
  const missing = value === "uncategorized";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          compact ? (
            <button
              type="button"
              className={`inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border px-2 text-[.8125rem] transition-colors disabled:opacity-50 ${missing ? "border-dashed border-warning/70 text-warning hover:bg-warning/10" : "border-transparent bg-muted hover:border-control-border-hover"}`}
              disabled={disabled}
              aria-label={ariaLabel ?? `Category: ${selected.label}`}
            />
          ) : (
            <Button
              type="button"
              variant="outline"
              size={mobile ? "default" : "sm"}
              className={`${mobile ? "h-11 w-full" : "min-w-40"} justify-between rounded-md font-normal`}
              disabled={disabled}
              aria-label={ariaLabel ?? `Category: ${selected.label}`}
            />
          )
        }
      >
        {compact && missing ? <span>Choose category</span> : <CategoryValue category={value} />}
        <ChevronDown className={compact ? "size-3.5 opacity-60" : "ml-auto text-muted-foreground"} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))] gap-0 p-0">
        <Command>
          <CommandInput autoFocus placeholder="Find a category…" />
          <CommandList className="max-h-[min(28rem,70vh)]">
            <CommandEmpty>No category found.</CommandEmpty>
            {suggestions.length ? (
              <CommandGroup heading="Suggested">
                {suggestions.map((category) => (
                  <CommandItem
                    key={category}
                    value={`suggested ${moneyCategorySearchValue(category)}`}
                    onSelect={() => {
                      onValue(category);
                      setOpen(false);
                    }}
                  >
                    <CategoryValue category={category} />
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {CATEGORY_GROUPS.map((group) => (
              <CommandGroup key={group.label} heading={group.label}>
                <div className="grid sm:grid-cols-2">
                  {group.categories.map((category) => (
                    <CommandItem
                      key={category}
                      value={moneyCategorySearchValue(category)}
                      data-checked={category === value}
                      onSelect={() => {
                        onValue(category);
                        setOpen(false);
                      }}
                    >
                      <CategoryValue category={category} />
                    </CommandItem>
                  ))}
                </div>
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function CategoryValue({ category }: Readonly<{ category: MoneyCategory }>) {
  const meta = CATEGORY_META[category];
  const Icon = meta.icon;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className={`grid size-5 shrink-0 place-items-center rounded-md ${meta.colors}`}>
        <Icon className="size-3.5" />
      </span>
      <span className="truncate">{meta.label}</span>
    </span>
  );
}

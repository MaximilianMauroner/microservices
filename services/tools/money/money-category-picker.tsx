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
  housing: { label: "Housing", icon: House, colors: "bg-rose-400/15 text-rose-400", searchTerms: "rent mortgage utilities electricity gas water home apartment property maintenance repair cleaning" },
  groceries: { label: "Groceries", icon: ShoppingBasket, colors: "bg-emerald-400/15 text-emerald-400", searchTerms: "supermarket grocery food market household bakery butcher convenience supplies" },
  dining: { label: "Dining", icon: Utensils, colors: "bg-orange-400/15 text-orange-400", searchTerms: "restaurant cafe coffee takeaway lunch dinner bar delivery" },
  transport: { label: "Transport", icon: Bus, colors: "bg-sky-400/15 text-sky-400", searchTerms: "train bus metro subway tram taxi uber rideshare fuel petrol parking car vehicle bicycle bike commute toll rental" },
  shopping: { label: "Shopping", icon: ShoppingBag, colors: "bg-purple-400/15 text-purple-400", searchTerms: "retail clothes clothing shoes electronics purchase store books hardware furniture appliance" },
  health: { label: "Health", icon: HeartPulse, colors: "bg-teal-400/15 text-teal-400", searchTerms: "doctor pharmacy medicine dentist hospital gym fitness insurance optical glasses therapy counseling vet veterinary pet" },
  personal_care: { label: "Personal care", icon: Scissors, colors: "bg-pink-300/15 text-pink-300", searchTerms: "barber hairdresser haircut salon beauty spa nails cosmetics makeup skincare grooming massage tattoo piercing laundry dry cleaning" },
  travel: { label: "Travel", icon: Plane, colors: "bg-blue-400/15 text-blue-400", searchTerms: "flight airline hotel hostel resort holiday vacation booking airbnb luggage trip cruise visa tourism" },
  subscriptions: { label: "Subscriptions", icon: Repeat2, colors: "bg-violet-400/15 text-violet-400", searchTerms: "recurring membership software streaming plan monthly internet mobile phone cloud hosting newspaper magazine" },
  education: { label: "Education", icon: GraduationCap, colors: "bg-indigo-400/15 text-indigo-400", searchTerms: "school university course books tuition training learning childcare daycare exam certification" },
  entertainment: { label: "Entertainment", icon: Clapperboard, colors: "bg-fuchsia-400/15 text-fuchsia-400", searchTerms: "cinema movie concert game gaming theatre music event sports museum festival ticket hobby" },
  gifts: { label: "Gifts", icon: Gift, colors: "bg-pink-400/15 text-pink-400", searchTerms: "present donation charity flowers birthday wedding" },
  taxes: { label: "Taxes", icon: Landmark, colors: "bg-red-400/15 text-red-400", searchTerms: "tax vat government duty revenue" },
  fees: { label: "Fees", icon: ReceiptText, colors: "bg-amber-500/15 text-amber-500", searchTerms: "fee charge commission penalty service cost legal lawyer accountant accounting postage shipping professional" },
  cash: { label: "Cash", icon: WalletCards, colors: "bg-cyan-400/15 text-cyan-400", searchTerms: "atm withdrawal deposit notes coins" },
  investments: { label: "Investments", icon: ChartNoAxesCombined, colors: "bg-indigo-300/15 text-indigo-300", searchTerms: "stock shares etf crypto trade broker portfolio dividend" },
  income: { label: "Income", icon: CircleDollarSign, colors: "bg-green-400/15 text-green-400", searchTerms: "salary wage paycheck interest bonus earnings" },
  transfer: { label: "Transfer", icon: ArrowLeftRight, colors: "bg-cyan-300/15 text-cyan-300", searchTerms: "move money bank transfer topup top up internal send receive" },
  adjustment: { label: "Adjustment", icon: SlidersHorizontal, colors: "bg-slate-400/15 text-slate-400", searchTerms: "correction balance migration reconciliation" },
  other: { label: "Other", icon: Ellipsis, colors: "bg-zinc-400/15 text-zinc-400", searchTerms: "misc miscellaneous general" },
  uncategorized: { label: "Uncategorized", icon: CircleHelp, colors: "bg-yellow-400/15 text-yellow-400", searchTerms: "unknown needs category review unclassified" },
} as const satisfies Record<MoneyCategory, CategoryMeta>;

const CATEGORY_GROUPS = [
  { label: "Living", categories: ["housing", "groceries", "dining", "transport", "shopping", "health", "personal_care"] },
  { label: "Lifestyle", categories: ["travel", "subscriptions", "education", "entertainment", "gifts"] },
  { label: "Money", categories: ["income", "transfer", "cash", "investments", "taxes", "fees", "adjustment"] },
  { label: "Other", categories: ["other", "uncategorized"] },
] as const satisfies readonly Readonly<{ label: string; categories: readonly MoneyCategory[] }>[];

export function moneyCategorySearchValue(category: MoneyCategory) {
  const meta = CATEGORY_META[category];
  return `${meta.label} ${category} ${meta.searchTerms}`;
}

export function MoneyCategoryPicker({
  value,
  onValue,
  disabled = false,
  mobile = false,
  ariaLabel,
}: Readonly<{
  value: MoneyCategory;
  onValue: (value: MoneyCategory) => void;
  disabled?: boolean;
  mobile?: boolean;
  ariaLabel?: string;
}>) {
  const [open, setOpen] = useState(false);
  const selected = CATEGORY_META[value];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size={mobile ? "default" : "sm"}
            className={`${mobile ? "h-11 w-full" : "min-w-40"} justify-between rounded-md font-normal`}
            disabled={disabled}
            aria-label={ariaLabel ?? `Category: ${selected.label}`}
          />
        }
      >
        <CategoryValue category={value} />
        <ChevronDown className="ml-auto text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))] gap-0 p-0">
        <Command>
          <CommandInput autoFocus placeholder="Find a category…" />
          <CommandList className="max-h-[min(28rem,70vh)]">
            <CommandEmpty>No category found.</CommandEmpty>
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

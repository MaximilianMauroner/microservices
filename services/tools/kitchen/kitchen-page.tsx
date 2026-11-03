import { CalendarDaysIcon, CookingPotIcon, RefrigeratorIcon, ShoppingBasketIcon } from "lucide-react";
import { AppShell } from "../src/components/app-shell.js";
import { PageHeader } from "../src/components/page-header.js";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../src/components/ui/empty.js";

const COMING = [
  { icon: CookingPotIcon, title: "Recipes", text: "Your dishes with portions and ingredients" },
  { icon: CalendarDaysIcon, title: "Week plan", text: "What you cook on which day" },
  { icon: ShoppingBasketIcon, title: "Shopping list", text: "Calculated from the plan, minus what you have" },
  { icon: RefrigeratorIcon, title: "At home", text: "Food in stock and leftovers to use first" }
] as const;

export function KitchenPage() {
  return (
    <>
      <AppShell product="Kitchen" />
      <main id="main" className="tools-page">
        <PageHeader title="Kitchen" facts="Your recipes, week plan, shopping list, and food at home" />
        <Empty className="max-w-3xl rounded-xl bg-card px-4 py-10 ring-1 ring-[color:var(--surface-border)]">
          <EmptyHeader>
            <EmptyMedia variant="icon"><CookingPotIcon /></EmptyMedia>
            <EmptyTitle>Your kitchen is empty</EmptyTitle>
            <EmptyDescription>Kitchen is being built. These parts come next, and only you see your data.</EmptyDescription>
          </EmptyHeader>
          <ul className="mt-2 grid w-full max-w-xl gap-2 text-left sm:grid-cols-2">
            {COMING.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex items-start gap-3 rounded-lg bg-muted/50 px-3 py-2.5">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0"><strong className="block text-sm font-semibold">{title}</strong><span className="block text-[0.8125rem] text-muted-foreground">{text}</span></span>
              </li>
            ))}
          </ul>
        </Empty>
      </main>
    </>
  );
}

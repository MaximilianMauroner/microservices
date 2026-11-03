import { AppShell } from "../src/components/app-shell.js";
import { PageHeader } from "../src/components/page-header.js";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../src/components/ui/empty.js";

export function KitchenPage() {
  return (
    <>
      <AppShell product="Kitchen" />
      <main id="main" className="tools-page">
        <PageHeader title="Kitchen" facts="Your recipes, week plan, shopping list, and food at home" />
        <Empty className="max-w-3xl rounded-xl bg-card ring-1 ring-[color:var(--surface-border)]">
          <EmptyHeader>
            <EmptyTitle>Your kitchen is empty</EmptyTitle>
            <EmptyDescription>Recipes, the week plan, and the shopping list come next.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </main>
    </>
  );
}

import { AppShell } from "./app-shell.js";
import { PageHeader } from "./page-header.js";

/** Shared, motion-free fallback shown only while a TanStack route loader is pending. */
export function RoutePendingPage() {
  return <><AppShell product="Tools" /><main id="main" className="tools-page" aria-busy="true">
    <PageHeader title="Loading page" facts="Preparing the latest data." />
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_19.5rem]" aria-label="Loading content">
      <section className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-[color:var(--surface-border)]">
        <Block className="h-4 w-40" />
        {Array.from({ length: 6 }, (_, index) => <Block key={index} className="h-9 w-full" />)}
      </section>
      <section className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-[color:var(--surface-border)]">
        <Block className="h-4 w-32" />
        <Block className="h-24 w-full" />
      </section>
    </div>
  </main></>;
}

function Block({ className }: { className: string }) {
  return <div className={`rounded-md bg-muted ${className}`} />;
}

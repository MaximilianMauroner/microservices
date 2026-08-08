import { AppShell } from "./app-shell.js";
import { Card, CardContent, CardHeader } from "./ui/card.js";

/** Shared, motion-free fallback shown only while a TanStack route loader is pending. */
export function RoutePendingPage() {
  return <><AppShell active="tools" showSignOut /><main id="main" className="app-page space-y-4" aria-busy="true">
    <header className="app-heading mb-0"><div><p className="eyebrow">Mauroner Tools</p><h1>Loading page</h1><p>Preparing the latest data.</p></div></header>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Loading summary">
      {Array.from({ length: 4 }, (_, index) => <Card key={index}><CardContent className="space-y-3 p-4"><Block className="h-3 w-24" /><Block className="h-7 w-32" /><Block className="h-3 w-20" /></CardContent></Card>)}
    </section>
    <section className="grid gap-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(18rem,.7fr)]" aria-label="Loading content">
      <Card><CardHeader className="border-b"><Block className="h-4 w-40" /><Block className="h-3 w-64 max-w-full" /></CardHeader><CardContent className="pt-5"><Block className="h-[19rem] w-full" /></CardContent></Card>
      <Card><CardHeader className="border-b"><Block className="h-4 w-40" /><Block className="h-3 w-48 max-w-full" /></CardHeader><CardContent className="space-y-3 pt-5">{Array.from({ length: 5 }, (_, index) => <Block key={index} className="h-10 w-full" />)}</CardContent></Card>
    </section>
  </main></>;
}

function Block({ className }: { className: string }) {
  return <div className={`rounded-md bg-muted ${className}`} />;
}

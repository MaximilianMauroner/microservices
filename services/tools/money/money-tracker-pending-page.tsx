import { AppShell } from "../src/components/app-shell.js";
import { favicons } from "../src/favicons.js";
import { Card, CardContent, CardHeader } from "../src/components/ui/card.js";
import { MoneyNav, moneyViewTitle, type MoneyTrackerView } from "./money-tracker-navigation.js";

export function MoneyTrackerPendingPage({ view }: { view: MoneyTrackerView }) {
  return <><AppShell product="Money" accent="lime" icon={favicons.money} showSignOut /><main id="main" className="app-page money-page" aria-busy="true">
    <header className="app-heading mb-0">
      <div><p className="eyebrow">Money</p><h1>{moneyViewTitle(view)}</h1><p>Loading private financial data.</p></div>
    </header>
    <div className="money-layout"><MoneyNav /><div className="money-content space-y-4">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Loading summary">
        {Array.from({ length: 4 }, (_, index) => <Card key={index}><CardContent className="space-y-3 p-4"><LoadingBlock className="h-3 w-24" /><LoadingBlock className="h-7 w-32" /><LoadingBlock className="h-3 w-20" /></CardContent></Card>)}
      </section>
      <section className="grid gap-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(18rem,.7fr)]" aria-label="Loading dashboard">
        <Card><CardHeader className="border-b"><LoadingBlock className="h-4 w-40" /><LoadingBlock className="h-3 w-64 max-w-full" /></CardHeader><CardContent className="pt-5"><LoadingBlock className="h-[19rem] w-full" /></CardContent></Card>
        <Card><CardHeader className="border-b"><LoadingBlock className="h-4 w-40" /><LoadingBlock className="h-3 w-48 max-w-full" /></CardHeader><CardContent className="space-y-3 pt-5">{Array.from({ length: 5 }, (_, index) => <LoadingBlock key={index} className="h-10 w-full" />)}</CardContent></Card>
      </section>
    </div></div>
  </main></>;
}

function LoadingBlock({ className }: { className: string }) {
  return <div className={`rounded-md bg-muted ${className}`} />;
}

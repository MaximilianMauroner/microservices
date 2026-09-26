import { AppShell } from "../src/components/app-shell.js";
import { favicons } from "../src/favicons.js";
import { Card } from "../src/components/ui/card.js";
import { moneyViewTitle, type MoneyTrackerView } from "./money-tracker-navigation.js";

export function MoneyTrackerPendingPage({ view }: { view: MoneyTrackerView }) {
  return <><AppShell product="Money" accent="lime" icon={favicons.money} showSignOut /><main id="main" className="money-page" aria-busy="true">
    <header className="money-heading">
      <div><h1>{moneyViewTitle(view)}</h1><p>Loading private financial data.</p></div>
    </header>
    <div className="money-strip" aria-label="Loading summary">
      {Array.from({ length: 4 }, (_, index) => <div key={index} className="money-stat space-y-2"><LoadingBlock className="h-3 w-20" /><LoadingBlock className="h-6 w-28" /><LoadingBlock className="h-3 w-24" /></div>)}
    </div>
    <div className="money-grid money-grid--main" aria-label="Loading dashboard">
      <Card className="gap-3 p-4"><LoadingBlock className="h-4 w-32" /><LoadingBlock className="h-60 w-full" /></Card>
      <Card className="gap-3 p-4"><LoadingBlock className="h-4 w-32" />{Array.from({ length: 5 }, (_, index) => <LoadingBlock key={index} className="h-8 w-full" />)}</Card>
    </div>
  </main></>;
}

function LoadingBlock({ className }: { className: string }) {
  return <div className={`rounded-md bg-muted ${className}`} />;
}

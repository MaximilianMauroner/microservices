import { AppShell } from "@/components/app-shell";
import { favicons } from "@/favicons";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { moneyViewTitle, type MoneyTrackerView } from "./money-tracker-navigation.js";

export function MoneyTrackerPendingPage({ view }: { view: MoneyTrackerView }) {
  return <><AppShell product="Money" accent="lime" icon={favicons.money} /><main id="main" className="money-page" aria-busy="true">
    <header className="money-heading">
      <div><h1>{moneyViewTitle(view)}</h1><p>Loading private financial data.</p></div>
    </header>
    <div className="money-strip" aria-label="Loading summary">
      {Array.from({ length: 4 }, (_, index) => <div key={index} className="money-stat space-y-2"><Skeleton className="h-3 w-20" /><Skeleton className="h-6 w-28" /><Skeleton className="h-3 w-24" /></div>)}
    </div>
    <div className="money-grid money-grid--main" aria-label="Loading dashboard">
      <Card className="gap-3 p-4"><Skeleton className="h-4 w-32" /><Skeleton className="h-60 w-full" /></Card>
      <Card className="gap-3 p-4"><Skeleton className="h-4 w-32" />{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-8 w-full" />)}</Card>
    </div>
  </main></>;
}

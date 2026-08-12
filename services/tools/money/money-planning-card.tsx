import type { MoneyTrackerPageData } from "../src/protected-data.js";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "../src/components/ui/alert.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../src/components/ui/card.js";

const euro = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});

export function MoneyPlanningCard({
  planning,
}: Pick<MoneyTrackerPageData, "planning">) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Run-rate scenario</CardTitle>
        <CardDescription>
          Median of the latest 6 to 12 consecutive months with imported
          cash-flow activity. The current partial month is excluded.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-5">
        {planning.ready ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Monthly median</p>
                <strong className="mt-1 block font-mono text-xl">
                  {signedEuro(planning.medianMonthlyNetMinor)}
                </strong>
                <p className="mt-1 text-xs text-muted-foreground">
                  {planning.observedMonthCount} consecutive activity months
                </p>
              </div>
              {planning.projections.map((item) => (
                <div
                  className="rounded-md border bg-muted/20 p-3"
                  key={item.months}
                >
                  <p className="text-xs text-muted-foreground">
                    Simple{" "}
                    {item.months === 60
                      ? "5-year"
                      : `${item.months}-month`}{" "}
                    run rate
                  </p>
                  <strong
                    className={`mt-1 block font-mono text-lg ${item.changeMinor < 0 ? "text-rose-300" : "text-emerald-300"}`}
                  >
                    {signedEuro(item.changeMinor)}
                  </strong>
                </div>
              ))}
            </div>
            {planning.unresolvedTransferCount ? (
              <p className="text-xs text-muted-foreground">
                {planning.unresolvedTransferCount.toLocaleString("en-GB")} unresolved transfer rows excluded.
              </p>
            ) : null}
          </div>
        ) : (
          <Alert>
            <AlertTitle>Not enough history</AlertTitle>
            <AlertDescription>
              At least six consecutive past months with imported cash-flow
              activity are required. You currently have{" "}
              {planning.observedMonthCount}.
              {planning.unresolvedTransferCount ? (
                <>
                  {" "}
                  {planning.unresolvedTransferCount.toLocaleString("en-GB")} unresolved transfer rows are excluded.
                </>
              ) : null}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function signedEuro(minor: number) {
  return `${minor >= 0 ? "+" : ""}${euro.format(minor / 100)}`;
}

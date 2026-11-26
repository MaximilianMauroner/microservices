import { BodyScreen } from "../../ui/body/screen";
import { Insights } from "../../ui/body/insights";

export default function BodyInsightsPage() {
  return <BodyScreen page="insights">{(snapshot) => <Insights snapshot={snapshot} />}</BodyScreen>;
}

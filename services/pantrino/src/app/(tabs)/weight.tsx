import { BodyScreen } from "../../ui/body/screen";
import { WeightPage } from "../../ui/body/weight";

export default function BodyWeightPage() {
  return <BodyScreen page="weight">{(snapshot) => <WeightPage snapshot={snapshot} />}</BodyScreen>;
}

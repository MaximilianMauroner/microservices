import { BodyScreen } from "../../ui/body/screen";
import { Foods } from "../../ui/body/foods";

export default function BodyFoodsPage() {
  return <BodyScreen page="foods">{(snapshot) => <Foods snapshot={snapshot} />}</BodyScreen>;
}

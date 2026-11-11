import { Standalone } from "../../ui/page";
import { BodyScreen } from "../../ui/body/screen";
import { Foods } from "../../ui/body/foods";

export default function BodyshopFoods() {
  return <Standalone page="today"><BodyScreen page="today">{(snapshot) => <Foods snapshot={snapshot} />}</BodyScreen></Standalone>;
}

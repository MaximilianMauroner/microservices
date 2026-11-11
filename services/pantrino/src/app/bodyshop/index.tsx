import { Standalone } from "../../ui/page";
import { BodyScreen } from "../../ui/body/screen";
import { Today } from "../../ui/body/today";

export default function BodyshopToday() {
  return <Standalone page="today"><BodyScreen page="today">{(snapshot) => <Today snapshot={snapshot} />}</BodyScreen></Standalone>;
}

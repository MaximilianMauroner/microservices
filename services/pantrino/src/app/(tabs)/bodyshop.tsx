import { BodyScreen } from "../../ui/body/screen";
import { Today } from "../../ui/body/today";

export default function BodyshopToday() {
  return <BodyScreen page="today">{(snapshot) => <Today snapshot={snapshot} />}</BodyScreen>;
}

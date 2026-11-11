import { BodyScreen } from "../../ui/body/screen";
import { Today } from "../../ui/body/today";

export default function BodyDayPage() {
  return <BodyScreen page="day">{(snapshot) => <Today snapshot={snapshot} />}</BodyScreen>;
}

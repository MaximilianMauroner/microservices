import { KitchenScreen } from "../../ui/page";
import { Week } from "../../ui/week/page";

export default function WeekPage() {
  return <KitchenScreen page="week">{(data) => <Week key={data.kitchen.kitchen.id} data={data} />}</KitchenScreen>;
}

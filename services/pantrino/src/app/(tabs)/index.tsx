import { KitchenScreen } from "../../ui/page";
import { Today } from "../../ui/today/page";

export default function TodayPage() {
  return <KitchenScreen page="today">{(data) => <Today key={data.kitchen.kitchen.id} data={data} />}</KitchenScreen>;
}

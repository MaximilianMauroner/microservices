import { KitchenScreen } from "../../ui/page";
import { Screen, T } from "../../ui/kit";

export default function WeekPage() {
  return <KitchenScreen page="week">{({ kitchen }) => <Screen title="WeekPage"><T>{kitchen.kitchen.name}</T></Screen>}</KitchenScreen>;
}

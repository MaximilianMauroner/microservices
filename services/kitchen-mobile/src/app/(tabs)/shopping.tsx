import { KitchenScreen } from "../../ui/page";
import { Screen, T } from "../../ui/kit";

export default function ShoppingPage() {
  return <KitchenScreen page="shopping">{({ kitchen }) => <Screen title="ShoppingPage"><T>{kitchen.kitchen.name}</T></Screen>}</KitchenScreen>;
}

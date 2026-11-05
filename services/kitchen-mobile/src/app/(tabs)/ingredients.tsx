import { KitchenScreen } from "../../ui/page";
import { Screen, T } from "../../ui/kit";

export default function IngredientsPage() {
  return <KitchenScreen page="ingredients">{({ kitchen }) => <Screen title="IngredientsPage"><T>{kitchen.kitchen.name}</T></Screen>}</KitchenScreen>;
}

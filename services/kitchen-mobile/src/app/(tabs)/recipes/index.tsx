import { KitchenScreen } from "../../../ui/page";
import { Screen, T } from "../../../ui/kit";

export default function RecipesPage() {
  return <KitchenScreen page="recipes">{({ kitchen }) => <Screen title="RecipesPage"><T>{kitchen.kitchen.name}</T></Screen>}</KitchenScreen>;
}

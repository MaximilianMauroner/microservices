import { KitchenScreen } from "../../../ui/page";
import { Screen, T } from "../../../ui/kit";

export default function RecipePage() {
  return <KitchenScreen page="recipes">{({ kitchen }) => <Screen title="RecipePage"><T>{kitchen.kitchen.name}</T></Screen>}</KitchenScreen>;
}

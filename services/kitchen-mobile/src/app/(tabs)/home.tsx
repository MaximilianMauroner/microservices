import { KitchenScreen } from "../../ui/page";
import { Screen, T } from "../../ui/kit";

export default function HomePage() {
  return <KitchenScreen page="home">{({ kitchen }) => <Screen title="HomePage"><T>{kitchen.kitchen.name}</T></Screen>}</KitchenScreen>;
}

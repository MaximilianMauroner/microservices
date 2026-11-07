import { KitchenScreen } from "../../ui/page";
import { Pantry } from "../../ui/home/page";

export default function HomePage() {
  return <KitchenScreen page="home">{(data) => <Pantry key={data.kitchen.kitchen.id} {...data} />}</KitchenScreen>;
}

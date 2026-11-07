import { KitchenScreen } from "../../ui/page";
import { Shopping } from "../../ui/shopping/page";

export default function ShoppingPage() {
  return (
    <KitchenScreen page="shopping">{(data) => <Shopping key={data.kitchen.kitchen.id} {...data} />}</KitchenScreen>
  );
}

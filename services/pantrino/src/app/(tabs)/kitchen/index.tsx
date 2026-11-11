import { useLocalSearchParams } from "expo-router";
import { Ingredients } from "../../../ui/ingredients/page";
import { Pantry } from "../../../ui/home/page";
import { KitchenScreen } from "../../../ui/page";
import { Recipes } from "../../../ui/recipes/page";
import { KitchenLists } from "../../../ui/kitchen/lists";

export default function KitchenPage() {
  const { list } = useLocalSearchParams<{ list?: string }>();
  const selected = list === "home" || list === "ingredients" ? list : "recipes";
  return <KitchenScreen page="kitchen">{(data) => {
    const top = <KitchenLists selected={selected} />;
    return selected === "home" ? <Pantry key={data.kitchen.kitchen.id} {...data} top={top} />
      : selected === "ingredients" ? <Ingredients key={data.kitchen.kitchen.id} data={data} top={top} />
      : <Recipes key={data.kitchen.kitchen.id} data={data} top={top} />;
  }}</KitchenScreen>;
}

import { useLocalSearchParams } from "expo-router";
import { KitchenScreen } from "../../../ui/page";
import { Recipes } from "../../../ui/recipes/page";
import { KitchenLists } from "../../../ui/kitchen/lists";

export default function RecipePage() {
  const { recipeId } = useLocalSearchParams<{ recipeId: string }>();
  return <KitchenScreen page="kitchen">{(data) => <Recipes key={`${data.kitchen.kitchen.id}/${recipeId}`} data={data} initialRecipeId={recipeId} top={<KitchenLists selected="recipes" />} />}</KitchenScreen>;
}

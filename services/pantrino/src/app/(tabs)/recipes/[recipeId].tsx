import { useLocalSearchParams } from "expo-router";
import { KitchenScreen } from "../../../ui/page";
import { RecipePageContent } from "../../../ui/recipes/recipe-page";

export default function RecipePage() {
  const { recipeId } = useLocalSearchParams<{ recipeId: string }>();
  return <KitchenScreen page="recipes">{(data) => <RecipePageContent key={`${data.kitchen.kitchen.id}/${recipeId}`} data={data} recipeId={recipeId} />}</KitchenScreen>;
}

import { Stack } from "expo-router";
import { useColors } from "../../ui/theme";

export default function BodyshopStack() {
  const colors = useColors();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
}

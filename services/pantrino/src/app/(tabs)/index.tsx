import { KitchenScreen } from "../../ui/page";
import { Empty, Screen, useKitText } from "../../ui/kit";

export default function TodayPage() {
  const text = useKitText();
  return <KitchenScreen page="today">{() => <Screen title={text.tabs.today[0]}><Empty title={text.tabs.today[0]} /></Screen>}</KitchenScreen>;
}

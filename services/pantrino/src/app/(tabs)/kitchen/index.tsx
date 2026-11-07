import { KitchenHub } from "../../../ui/kitchen/page";
import { PageContext } from "../../../ui/kit";

export default function KitchenPage() {
  return <PageContext.Provider value="kitchen"><KitchenHub /></PageContext.Provider>;
}

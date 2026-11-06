import type { ReactNode } from "react";
import { ActivityIndicator, ScrollView } from "react-native";
import { type OpenKitchen, useKitchen, useSync } from "../state";
import { Empty, PageContext, SyncRefresh } from "./kit";
import { type KitchenLanguage, useText } from "./language";
import type { PageKey } from "./theme";

const en = { loading: "Loading your kitchens", none: "No kitchen yet", noneBody: "Ask the admin to add you to a kitchen, then pull to sync.", offline: "No connection", offlineBody: "Kitchen needs one connection to download your kitchens. After that it works offline." };
const TEXT: Record<KitchenLanguage, typeof en> = {
  en,
  de: { loading: "Deine Küchen werden geladen", none: "Noch keine Küche", noneBody: "Bitte den Admin, dich zu einer Küche hinzuzufügen, und synchronisiere dann.", offline: "Keine Verbindung", offlineBody: "Kitchen braucht einmal eine Verbindung, um deine Küchen zu laden. Danach geht es offline." }
};

/** One page of the open kitchen, in its produce color. It shows a wait or an empty state until a kitchen is on the phone. */
export function KitchenScreen({ page, children }: { page: PageKey; children: (kitchen: OpenKitchen) => ReactNode }) {
  const kitchen = useKitchen();
  const { view, status } = useSync();
  const text = useText(TEXT);
  return (
    <PageContext.Provider value={page}>
      {kitchen ? children(kitchen) : (
        <ScrollView contentContainerStyle={{ padding: 16 }} refreshControl={<SyncRefresh />}>
          {view ? <Empty title={text.none} body={text.noneBody} />
            : status.kind === "offline" ? <Empty title={text.offline} body={text.offlineBody} />
            : <Empty title={text.loading}><ActivityIndicator /></Empty>}
        </ScrollView>
      )}
    </PageContext.Provider>
  );
}

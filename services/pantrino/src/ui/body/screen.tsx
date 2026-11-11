import { router } from "expo-router";
import type { BodyshopAppSnapshot } from "@tools-platform/service/bodyshop-contract";
import type { ReactNode } from "react";
import { ActivityIndicator, ScrollView } from "react-native";
import { bodyStore, useBody } from "../../body/store";
import { Button, Empty, PageContext, Screen, useKitText } from "../kit";
import { useText } from "../language";
import type { PageKey } from "../theme";
import { TEXT } from "./text";

/** One Bodyshop page in its color. Until a day is on the phone, it shows why: loading, offline, no access, or an error. */
export function BodyScreen({ page, children }: { page: PageKey; children: (snapshot: BodyshopAppSnapshot) => ReactNode }) {
  const { snapshot, status } = useBody();
  const text = useText(TEXT);
  const kitText = useKitText();
  return (
    <PageContext.Provider value={page}>
      {snapshot && status !== "no-access" ? children(snapshot) : (
        <Screen title="Bodyshop" back={{ label: kitText.back, onPress: () => router.back() }}>
          {status === "no-access" ? <Empty title={text.noAccess} body={text.noAccessBody} />
            : status === "offline" ? <Empty title={text.offline} body={text.offlineBody} />
            : status === "failed" ? <Empty title={text.notLoaded}><Button label={text.tryAgain} onPress={() => void bodyStore.refresh()} /></Empty>
            : <Empty title={text.loading}><ActivityIndicator /></Empty>}
        </Screen>
      )}
    </PageContext.Provider>
  );
}

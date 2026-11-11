import NetInfo from "@react-native-community/netinfo";
import { type KitchenSnapshot, today as kitchenToday } from "@tools-platform/service/kitchen-contract";
import * as Crypto from "expo-crypto";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { bodyStore } from "./body/store";
import { Offline, signIn as openSignIn, signOut as endSession, SignedOut, storedAccount } from "./auth/session";
import { localVault, wipeVault, vault } from "./storage/vault";
import { allowKitchenNetwork, kitchenApi } from "./sync/api";
import { createSyncEngine, type SyncState } from "./sync/engine";
import type { QueuedAction } from "./sync/model";
import { project } from "./sync/project";
import { createLocalEngine } from "./sync/local";
import { createKitchenSession } from "./kitchen-session";
import { HapticsContext, parseStrength, setStrength, type Strength } from "./ui/haptics";
import { type KitchenLanguage, LanguageContext, pickLanguage } from "./ui/language";

const kitchenSession = createKitchenSession({
  accountEngine: createSyncEngine({ vault, api: kitchenApi, project, newId: () => Crypto.randomUUID(), isSignedOut: (error) => error instanceof SignedOut, isOffline: (error) => error instanceof Offline }),
  localEngine: createLocalEngine({ vault: localVault, newId: () => Crypto.randomUUID() }),
  accountVault: vault, localVault, wipeAccount: wipeVault,
  auth: { storedAccount, signIn: openSignIn, signOut: endSession },
  allowNetwork: allowKitchenNetwork,
});

type AppContextValue = ReturnType<typeof kitchenSession.getState> & Pick<typeof kitchenSession, "signIn" | "signOut" | "openLocal" | "showSignIn" | "openKitchen">;

// Bodyshop belongs to the signed-in account. The session publishes every step, also the short `loading` between two
// accounts, so the last account's day is gone before the next one opens.
let bodySession: string | null = null;
kitchenSession.subscribe(() => {
  const { session } = kitchenSession.getState();
  if (session === bodySession) return;
  bodySession = session;
  if (session === "signed-in") void bodyStore.load();
  else bodyStore.reset();
});

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(kitchenSession.subscribe, kitchenSession.getState);
  const [language, setLanguage] = useState<KitchenLanguage>(() => pickLanguage(null));
  const [strength, setStrengthState] = useState<Strength>("light");

  useEffect(() => { void kitchenSession.start().catch(() => undefined); }, []);

  useEffect(() => {
    let current = true;
    void Promise.all([kitchenSession.setting("language"), kitchenSession.setting("haptics")]).then(([savedLanguage, savedStrength]) => {
      if (!current) return;
      setLanguage(pickLanguage(savedLanguage));
      setStrength(parseStrength(savedStrength));
      setStrengthState(parseStrength(savedStrength));
    }).catch(() => undefined);
    return () => { current = false; };
  }, [state.session]);

  useEffect(() => {
    if (state.session !== "signed-in") return;
    const app = AppState.addEventListener("change", (next) => {
      kitchenSession.onAppState(next);
      if (next === "active") void bodyStore.refresh();
    });
    let online: boolean | null = null;
    const net = NetInfo.addEventListener(({ isConnected }) => {
      kitchenSession.onConnectivity(isConnected);
      if (isConnected && online === false) void bodyStore.refresh();
      online = isConnected;
    });
    return () => { app.remove(); net(); };
  }, [state.session]);

  const value = useMemo<AppContextValue>(() => ({
    ...state,
    signIn: kitchenSession.signIn,
    signOut: kitchenSession.signOut,
    openLocal: kitchenSession.openLocal,
    showSignIn: kitchenSession.showSignIn,
    openKitchen: kitchenSession.openKitchen,
  }), [state]);

  const languageValue = useMemo(() => ({
    language,
    setLanguage(next: KitchenLanguage) {
      setLanguage(next);
      void kitchenSession.saveSetting("language", next);
    }
  }), [language]);

  const hapticsValue = useMemo(() => ({
    strength,
    setStrength(next: Strength) {
      setStrength(next);
      setStrengthState(next);
      void kitchenSession.saveSetting("haptics", next);
    }
  }), [strength]);

  return (
    <AppContext.Provider value={value}>
      <LanguageContext.Provider value={languageValue}><HapticsContext.Provider value={hapticsValue}>{children}</HapticsContext.Provider></LanguageContext.Provider>
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp needs AppProvider.");
  return value;
}

export function useSync(): SyncState & { sync: () => Promise<void>; dismiss: (clientActionId: string) => Promise<void> } {
  const state = useSyncExternalStore(kitchenSession.subscribe, kitchenSession.getSyncState);
  return { ...state, sync: kitchenSession.sync, dismiss: kitchenSession.dismiss };
}

export type OpenKitchen = Readonly<{
  kitchen: KitchenSnapshot;
  kitchens: readonly KitchenSnapshot[];
  today: string;
  planFrom: string;
  /** Shows an edit at once and stores it in the active kitchen mode. */
  change: (action: QueuedAction) => void;
}>;

/** The active kitchen with in-flight edits. Account kitchens need a first sync; local kitchens start empty. */
export function useKitchen(): OpenKitchen | null {
  const { kitchenId } = useApp();
  const { view } = useSync();
  const local = useToday();
  return useMemo(() => {
    if (!view?.kitchens.length) return null;
    const kitchen = view.kitchens.find((one) => one.kitchen.id === kitchenId) ?? view.kitchens[0]!;
    return { kitchen, kitchens: view.kitchens, today: local > view.today ? local : view.today, planFrom: view.planFrom, change: (action) => void kitchenSession.change(kitchen.kitchen.id, action) };
  }, [view, kitchenId, local]);
}

/** The phone's day in the Tools time zone. Offline, the snapshot's day gets old, and a screen can stay open past midnight. */
function useToday(): string {
  const [day, setDay] = useState(kitchenToday);
  useEffect(() => {
    const timer = setInterval(() => setDay(kitchenToday()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return day;
}

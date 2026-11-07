import NetInfo from "@react-native-community/netinfo";
import { type KitchenSnapshot, today as kitchenToday } from "@tools-platform/service/kitchen-contract";
import * as Crypto from "expo-crypto";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { bodyStore } from "./body/store";
import { Offline, signIn as openSignIn, signOut as endSession, SignedOut, storedAccount } from "./auth/session";
import { wipeVault, vault } from "./storage/vault";
import { kitchenApi } from "./sync/api";
import { createSyncEngine, type SyncEngine, type SyncState } from "./sync/engine";
import type { QueuedAction } from "./sync/model";
import { project } from "./sync/project";
import { HapticsContext, parseStrength, setStrength, type Strength } from "./ui/haptics";
import { type KitchenLanguage, LanguageContext, pickLanguage } from "./ui/language";

const engine: SyncEngine = createSyncEngine({ vault, api: kitchenApi, project, newId: () => Crypto.randomUUID(), isSignedOut: (error) => error instanceof SignedOut, isOffline: (error) => error instanceof Offline });

type Session = "loading" | "signed-out" | "signed-in";
/** Which product the tabs show. Search and the links between them work in both. */
export type Mode = "kitchen" | "bodyshop";

type AppContextValue = {
  session: Session;
  signIn: () => Promise<void>;
  /** Signs out and deletes every kitchen byte on the phone. Unsent changes are lost, so the screen asks first. */
  signOut: () => Promise<void>;
  kitchenId: string | null;
  openKitchen: (kitchenId: string) => void;
  mode: Mode;
  setMode: (mode: Mode) => void;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>("loading");
  const [kitchenId, setKitchenId] = useState<string | null>(null);
  const [mode, setModeState] = useState<Mode>("kitchen");
  const [language, setLanguage] = useState<KitchenLanguage>(() => pickLanguage(null));
  const [strength, setStrengthState] = useState<Strength>("light");
  const state = useSyncExternalStore(engine.subscribe, engine.getState);

  /** Opens the stored account. A vault from any other account is deleted first, also after a crash during sign-in. */
  const start = useCallback(async () => {
    const account = await storedAccount();
    if (!account) {
      setSession("signed-out");
      return;
    }
    if ((await vault.setting("account")) !== account) {
      await wipeVault();
      await vault.saveSetting("account", account);
    }
    const [saved, savedLanguage, savedStrength, savedMode] = await Promise.all([vault.setting("kitchen"), vault.setting("language"), vault.setting("haptics"), vault.setting("mode")]);
    setKitchenId(saved);
    setModeState(savedMode === "bodyshop" ? "bodyshop" : "kitchen");
    setLanguage(pickLanguage(savedLanguage));
    setStrength(parseStrength(savedStrength));
    setStrengthState(parseStrength(savedStrength));
    await engine.load();
    setSession("signed-in");
    void engine.sync();
    void bodyStore.load();
  }, []);

  useEffect(() => {
    void start();
  }, [start]);

  useEffect(() => {
    if (session !== "signed-in") return;
    const app = AppState.addEventListener("change", (next) => {
      if (next === "active" || (next === "background" && engine.getState().pending)) void engine.sync();
      if (next === "active") void bodyStore.refresh();
    });
    let online: boolean | null = null;
    const net = NetInfo.addEventListener(({ isConnected }) => {
      if (isConnected && online === false) { void engine.sync(); void bodyStore.refresh(); }
      online = isConnected;
    });
    return () => { app.remove(); net(); };
  }, [session]);

  useEffect(() => {
    if (state.signedOut) setSession("signed-out");
  }, [state.signedOut]);

  const value = useMemo<AppContextValue>(() => ({
    session,
    kitchenId,
    async signIn() {
      const next = await openSignIn();
      if (!next) return;
      // The vault may hold another account's kitchens and unsent changes. They go before this account's token is stored.
      await engine.stop();
      bodyStore.reset();
      if ((await vault.setting("account")) !== next.account) await wipeVault();
      await vault.saveSetting("account", next.account);
      await next.install();
      await start();
    },
    async signOut() {
      await engine.stop();
      await endSession();
      await wipeVault();
      bodyStore.reset();
      setKitchenId(null);
      setSession("signed-out");
    },
    openKitchen(id) {
      setKitchenId(id);
      void vault.saveSetting("kitchen", id);
    },
    mode,
    setMode(next) {
      setModeState(next);
      void vault.saveSetting("mode", next);
    }
  }), [session, kitchenId, mode, start]);

  const languageValue = useMemo(() => ({
    language,
    setLanguage(next: KitchenLanguage) {
      setLanguage(next);
      void vault.saveSetting("language", next);
    }
  }), [language]);

  const hapticsValue = useMemo(() => ({
    strength,
    setStrength(next: Strength) {
      setStrength(next);
      setStrengthState(next);
      void vault.saveSetting("haptics", next);
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
  const state = useSyncExternalStore(engine.subscribe, engine.getState);
  return { ...state, sync: engine.sync, dismiss: engine.dismiss };
}

export type OpenKitchen = Readonly<{
  kitchen: KitchenSnapshot;
  kitchens: readonly KitchenSnapshot[];
  today: string;
  planFrom: string;
  /** Queues a change in this kitchen. The screen shows it at once; the server gets it when the phone is online. */
  change: (action: QueuedAction) => void;
}>;

/** The open kitchen as the screens see it: the last snapshot with every unsent change applied. `null` until the first sync. */
export function useKitchen(): OpenKitchen | null {
  const { kitchenId } = useApp();
  const { view } = useSync();
  const local = useToday();
  return useMemo(() => {
    if (!view?.kitchens.length) return null;
    const kitchen = view.kitchens.find((one) => one.kitchen.id === kitchenId) ?? view.kitchens[0]!;
    return { kitchen, kitchens: view.kitchens, today: local > view.today ? local : view.today, planFrom: view.planFrom, change: (action) => void engine.change(kitchen.kitchen.id, action) };
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

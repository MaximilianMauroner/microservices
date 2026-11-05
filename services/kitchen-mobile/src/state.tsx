import NetInfo from "@react-native-community/netinfo";
import { type KitchenSnapshot, today as kitchenToday } from "@tools-platform/service/kitchen-contract";
import * as Crypto from "expo-crypto";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { currentAccount, isSignedIn, Offline, signIn as openSignIn, signOut as endSession, SignedOut } from "./auth/session";
import { wipeVault, vault } from "./storage/vault";
import { kitchenApi } from "./sync/api";
import { createSyncEngine, type SyncEngine, type SyncState } from "./sync/engine";
import type { QueuedAction } from "./sync/model";
import { project } from "./sync/project";
import { type KitchenLanguage, LanguageContext, pickLanguage } from "./ui/language";

const engine: SyncEngine = createSyncEngine({ vault, api: kitchenApi, project, newId: () => Crypto.randomUUID(), isSignedOut: (error) => error instanceof SignedOut, isOffline: (error) => error instanceof Offline });

type Session = "loading" | "signed-out" | "signed-in";

type AppContextValue = {
  session: Session;
  signIn: () => Promise<void>;
  /** Signs out and deletes every kitchen byte on the phone. Unsent changes are lost, so the screen asks first. */
  signOut: () => Promise<void>;
  kitchenId: string | null;
  openKitchen: (kitchenId: string) => void;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>("loading");
  const [kitchenId, setKitchenId] = useState<string | null>(null);
  const [language, setLanguage] = useState<KitchenLanguage>(() => pickLanguage(null));
  const state = useSyncExternalStore(engine.subscribe, engine.getState);

  const start = useCallback(async () => {
    const [saved, savedLanguage] = await Promise.all([vault.setting("kitchen"), vault.setting("language")]);
    setKitchenId(saved);
    setLanguage(pickLanguage(savedLanguage));
    await engine.load();
    setSession("signed-in");
    void engine.sync();
  }, []);

  useEffect(() => {
    void (async () => (await isSignedIn()) ? start() : setSession("signed-out"))();
  }, [start]);

  useEffect(() => {
    if (session !== "signed-in") return;
    const app = AppState.addEventListener("change", (next) => { if (next === "active") void engine.sync(); });
    let online: boolean | null = null;
    const net = NetInfo.addEventListener(({ isConnected }) => {
      if (isConnected && online === false) void engine.sync();
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
      if (!(await openSignIn())) return;
      // The vault may hold another person's kitchens and unsent changes from an earlier sign-in. They must not reach this account.
      let account: string;
      try {
        account = await currentAccount();
      } catch (error) {
        await endSession();
        throw error;
      }
      if ((await vault.setting("account")) !== account) {
        await engine.stop();
        await wipeVault();
      }
      await vault.saveSetting("account", account);
      await start();
    },
    async signOut() {
      await engine.stop();
      await endSession();
      await wipeVault();
      setKitchenId(null);
      setSession("signed-out");
      await engine.load().catch(() => undefined);
    },
    openKitchen(id) {
      setKitchenId(id);
      void vault.saveSetting("kitchen", id);
    }
  }), [session, kitchenId, start]);

  const languageValue = useMemo(() => ({
    language,
    setLanguage(next: KitchenLanguage) {
      setLanguage(next);
      void vault.saveSetting("language", next);
    }
  }), [language]);

  return (
    <AppContext.Provider value={value}>
      <LanguageContext.Provider value={languageValue}>{children}</LanguageContext.Provider>
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
  return useMemo(() => {
    if (!view?.kitchens.length) return null;
    const kitchen = view.kitchens.find((one) => one.kitchen.id === kitchenId) ?? view.kitchens[0]!;
    // Offline, the snapshot's day gets old. The phone's own day, in the Tools time zone, keeps dates right.
    const local = kitchenToday();
    return { kitchen, kitchens: view.kitchens, today: local > view.today ? local : view.today, planFrom: view.planFrom, change: (action) => void engine.change(kitchen.kitchen.id, action) };
  }, [view, kitchenId]);
}

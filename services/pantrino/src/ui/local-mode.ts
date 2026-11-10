import { type KitchenLanguage, useText } from "./language";

const en = {
  title: "Local only",
  useLocal: "Use without an account",
  returnLocal: "Return to local kitchen",
  signIn: "Sign in",
  limits: "No sync or cloud backup. No online ingredient catalogue, barcode lookup, or Bodyshop. The camera still reads nutrition tables on this device. Your recipes, meal plan, shopping list, and manually added ingredients stay on this device only. Uninstalling the app loses this data.",
  separate: "Signing in opens a separate account kitchen. Your local kitchen stays on this device and is not uploaded or merged.",
  accountWarning: "Your account stays signed in on this device. Account sync pauses while you use the local kitchen. Signing in with a different account later deletes the previous account's data and unsent changes from this device.",
  catalogue: "Online ingredient catalogue and product search need an account and a connection. You can enter ingredients and nutrition yourself, or read them from the nutrition table.",
  saving: "Saving on this device",
  saved: "Saved on this device",
  failed: "Not saved. The phone could not store a change. Try it again.",
  openFailed: "The kitchen could not be opened or saved. Try again. Your local data has not been uploaded.",
  history: "Your local meal history starts when you created this kitchen.",
};

const TEXT: Record<KitchenLanguage, typeof en> = {
  en,
  de: {
    title: "Nur lokal",
    useLocal: "Ohne Konto verwenden",
    returnLocal: "Zur lokalen Küche zurück",
    signIn: "Anmelden",
    limits: "Keine Synchronisierung und kein Cloud-Backup. Kein Online-Zutatenkatalog, keine Barcode-Suche und kein Bodyshop. Die Kamera liest Nährwerttabellen weiter auf diesem Gerät. Deine Rezepte, dein Speiseplan, deine Einkaufsliste und manuell erfasste Zutaten bleiben nur auf diesem Gerät. Beim Deinstallieren der App gehen diese Daten verloren.",
    separate: "Die Anmeldung öffnet eine separate Kontoküche. Deine lokale Küche bleibt auf diesem Gerät. Sie wird nicht hochgeladen oder zusammengeführt.",
    accountWarning: "Dein Konto bleibt auf diesem Gerät angemeldet. Die Kontosynchronisierung pausiert, solange du die lokale Küche verwendest. Wenn du dich später mit einem anderen Konto anmeldest, werden die Daten und noch nicht gesendeten Änderungen des vorherigen Kontos von diesem Gerät gelöscht.",
    catalogue: "Der Online-Zutatenkatalog und die Produktsuche brauchen ein Konto und eine Verbindung. Du kannst Zutaten und Nährwerte selbst eingeben oder von der Nährwerttabelle lesen lassen.",
    saving: "Wird auf diesem Gerät gespeichert",
    saved: "Auf diesem Gerät gespeichert",
    failed: "Nicht gespeichert. Das Telefon konnte eine Änderung nicht speichern. Versuch es noch einmal.",
    openFailed: "Die Küche konnte nicht geöffnet oder gespeichert werden. Versuch es erneut. Deine lokalen Daten wurden nicht hochgeladen.",
    history: "Dein lokaler Speiseplan beginnt mit dem Erstellen dieser Küche.",
  },
};

export const useLocalText = () => useText(TEXT);

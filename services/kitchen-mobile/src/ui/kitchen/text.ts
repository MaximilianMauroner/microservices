import type { KitchenLanguage } from "../language";

const en = {
  title: "Kitchen",
  kitchens: "Kitchens",
  switchKitchen: "Switch",
  noKitchen: "No kitchen on this phone yet",
  noMembers: "No members yet",
  membersHint: "Add and remove members on the web.",
  ingredients: "Ingredients",
  ingredientsDetail: (count: number, groups: number) => `${count === 1 ? "1 ingredient" : `${count} ingredients`} in ${groups === 1 ? "1 group" : `${groups} groups`}`,
  language: "Language",
  syncing: "Syncing",
  offline: "Offline",
  failed: "Sync failed",
  unsent: (count: number) => (count === 1 ? "1 change not sent" : `${count} changes not sent`),
  synced: (time: string) => `Synced ${time}`,
  syncNow: "Sync now",
  refused: "Not saved",
  dismiss: "OK",
  signOut: "Sign out",
  signOutTitle: "Sign out?",
  signOutLoses: (count: number) => `${count === 1 ? "1 change was" : `${count} changes were`} not sent yet. Signing out deletes ${count === 1 ? "it" : "them"} and every kitchen on this phone.`,
  signOutBody: "This deletes every kitchen on this phone. Sign in again to download them.",
  cancel: "Cancel"
};

export const TEXT: Record<KitchenLanguage, typeof en> = {
  en,
  de: {
    title: "Küche",
    kitchens: "Küchen",
    switchKitchen: "Wechseln",
    noKitchen: "Noch keine Küche auf diesem Telefon",
    noMembers: "Noch keine Mitglieder",
    membersHint: "Mitglieder fügst du im Web hinzu und entfernst sie dort.",
    ingredients: "Zutaten",
    ingredientsDetail: (count: number, groups: number) => `${count === 1 ? "1 Zutat" : `${count} Zutaten`} in ${groups === 1 ? "1 Gruppe" : `${groups} Gruppen`}`,
    language: "Sprache",
    syncing: "Synchronisiert",
    offline: "Offline",
    failed: "Synchronisierung fehlgeschlagen",
    unsent: (count: number) => (count === 1 ? "1 Änderung nicht gesendet" : `${count} Änderungen nicht gesendet`),
    synced: (time: string) => `Synchronisiert ${time}`,
    syncNow: "Jetzt synchronisieren",
    refused: "Nicht gespeichert",
    dismiss: "OK",
    signOut: "Abmelden",
    signOutTitle: "Abmelden?",
    signOutLoses: (count: number) => `${count === 1 ? "1 Änderung wurde" : `${count} Änderungen wurden`} noch nicht gesendet. Abmelden löscht sie und alle Küchen auf diesem Telefon.`,
    signOutBody: "Das löscht alle Küchen auf diesem Telefon. Melde dich wieder an, um sie zu laden.",
    cancel: "Abbrechen"
  }
};

import { Link, useRouter } from "@tanstack/react-router";
import { PencilIcon, PlusIcon, Trash2Icon, UserPlusIcon, XIcon } from "lucide-react";
import { type CSSProperties, useState } from "react";
import { AppShell } from "../../../platform/ui/components/app-shell.js";
import { Button } from "../../../platform/ui/components/ui/button.js";
import { Input } from "../../../platform/ui/components/ui/input.js";
import { toast } from "../../../platform/ui/components/ui/toast.js";
import type { KitchenAdminAction } from "../actions.js";
import type { Kitchen } from "../domain.js";
import type { KitchenPerson } from "../repository.js";
import { runKitchenAdminAction } from "../server-functions.js";
import { KitchenSheet, LanguageMenu, memberLine, messageOf } from "./kit.js";
import { type KitchenLanguage, useLanguage, useText } from "./language.js";

type KitchensData = { kitchens: readonly Kitchen[]; isAdmin: boolean; people: readonly KitchenPerson[] };

const en = {
  title: "Kitchens",
  introAdmin: "Each kitchen has its own recipes, ingredients, plan, list, and stock. Its members share all of it.",
  introMember: "The kitchens you cook in.",
  newKitchen: "New kitchen",
  failed: "That did not work",
  rename: (name: string) => `Rename ${name}`,
  membersOf: (name: string) => `Members of ${name}`,
  removeMember: (email: string, name: string) => `Remove ${email} from ${name}`,
  leftKitchen: (email: string, name: string) => `${email} left ${name}`,
  addPersonTo: (name: string) => `Add a person to ${name}`,
  addPerson: "Add a person…",
  joined: (email: string, name: string) => `${email} joined ${name}`,
  everyoneMember: "Everyone you invited is a member.",
  inviteIn: "Invite people in",
  settings: "Settings",
  inviteFirst: "first.",
  accessNote: "Adding a person also gives them Kitchen access. You can open every kitchen.",
  open: "Open",
  delete: "Delete",
  deleteConfirm: (name: string) => `Delete ${name}? Its recipes, ingredients, plan, list, and stock are deleted too. This cannot be undone.`,
  deleted: (name: string) => `${name} deleted`,
  noKitchens: "No kitchens yet",
  notInKitchen: "You are not in a kitchen yet",
  createHint: "Create a kitchen for each household. Then add the people who cook in it.",
  askAdmin: "Ask the admin to add you to a kitchen. It then shows up here.",
  createFirst: "Create the first kitchen",
  renameTitle: (name: string) => `Rename ${name}`,
  renameButton: "Rename",
  createKitchen: "Create kitchen",
  renamed: "Kitchen renamed",
  created: (name: string) => `${name} created`,
  name: "Name",
  namePlaceholder: "Home, Max and Anna, …"
};
type KitText = typeof en;
const TEXT: Record<KitchenLanguage, KitText> = {
  en,
  de: {
    title: "Küchen",
    introAdmin: "Jede Küche hat eigene Rezepte, Zutaten, Wochenplan, Einkaufsliste und Vorrat. Ihre Mitglieder teilen alles.",
    introMember: "Die Küchen, in denen du kochst.",
    newKitchen: "Neue Küche",
    failed: "Das hat nicht funktioniert",
    rename: (name: string) => `${name} umbenennen`,
    membersOf: (name: string) => `Mitglieder von ${name}`,
    removeMember: (email: string, name: string) => `${email} aus ${name} entfernen`,
    leftKitchen: (email: string, name: string) => `${email} hat ${name} verlassen`,
    addPersonTo: (name: string) => `Person zu ${name} hinzufügen`,
    addPerson: "Person hinzufügen…",
    joined: (email: string, name: string) => `${email} ist ${name} beigetreten`,
    everyoneMember: "Alle, die du eingeladen hast, sind Mitglied.",
    inviteIn: "Lade zuerst Leute in",
    settings: "Einstellungen",
    inviteFirst: "ein.",
    accessNote: "Wer hinzugefügt wird, bekommt auch Zugriff auf Küchen. Du kannst jede Küche öffnen.",
    open: "Öffnen",
    delete: "Löschen",
    deleteConfirm: (name: string) => `${name} löschen? Die Rezepte, Zutaten, der Plan, die Liste und der Vorrat werden ebenfalls gelöscht. Das kann nicht rückgängig gemacht werden.`,
    deleted: (name: string) => `${name} gelöscht`,
    noKitchens: "Noch keine Küchen",
    notInKitchen: "Du bist noch in keiner Küche",
    createHint: "Lege für jeden Haushalt eine Küche an. Füge dann die Leute hinzu, die darin kochen.",
    askAdmin: "Bitte den Admin, dich zu einer Küche hinzuzufügen. Sie erscheint dann hier.",
    createFirst: "Erste Küche anlegen",
    renameTitle: (name: string) => `${name} umbenennen`,
    renameButton: "Umbenennen",
    createKitchen: "Küche anlegen",
    renamed: "Küche umbenannt",
    created: (name: string) => `${name} angelegt`,
    name: "Name",
    namePlaceholder: "Zuhause, Max und Anna, …"
  }
};

export function KitchensPage(data: KitchensData) {
  const router = useRouter();
  const language = useLanguage();
  const text = useText(TEXT);
  const [pending, setPending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Kitchen | undefined>();
  const [name, setName] = useState("");

  async function run(action: KitchenAdminAction, title: string) {
    setPending(true);
    try {
      const result = await runKitchenAdminAction({ data: action });
      await router.invalidate();
      toast.add({ title, type: "success" });
      return result;
    } catch (error) {
      toast.add({ title: text.failed, description: messageOf(error), type: "error" });
      return undefined;
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <AppShell product="Kitchen" />
      <main id="main" lang={language} className="tools-page kitchen-page kitchen-hue" style={{ "--kitchen-hue": "var(--kitchen-week)", "--kitchen-hue-ink": "var(--kitchen-week-ink)" } as CSSProperties}>
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-kitchen font-semibold tracking-tight text-[2rem] leading-[1.05] sm:text-[2.5rem]">{text.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {data.isAdmin ? text.introAdmin : text.introMember}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {data.isAdmin ? <Button onClick={() => { setName(""); setCreating(true); }}><PlusIcon aria-hidden /> {text.newKitchen}</Button> : null}
            <LanguageMenu />
          </div>
        </header>
        {data.kitchens.length ? (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.kitchens.map((kitchen) => {
              const outside = data.people.filter((person) => !kitchen.members.some((member) => member.personId === person.id));
              return (
                <li key={kitchen.id} className="flex min-w-0 flex-col gap-4 rounded-2xl border border-[color:var(--surface-border)] bg-card p-4">
                  <div className="flex items-start gap-3">
                    <span className="grid size-11 shrink-0 place-items-center rounded-full bg-muted font-kitchen font-semibold tracking-tight text-xl text-foreground" aria-hidden>{kitchen.name.slice(0, 1).toUpperCase()}</span>
                    <div className="min-w-0 flex-1">
                      <h2 className="font-kitchen font-semibold tracking-tight text-lg leading-tight break-words">{kitchen.name}</h2>
                      <p className="truncate text-xs text-muted-foreground">{memberLine(kitchen, language)}</p>
                    </div>
                    {data.isAdmin ? (
                      <Button size="icon-sm" variant="ghost" className="size-11 md:size-8" aria-label={text.rename(kitchen.name)} onClick={() => { setName(kitchen.name); setRenaming(kitchen); }}><PencilIcon /></Button>
                    ) : null}
                  </div>
                  {data.isAdmin ? (
                    <div className="grid gap-2">
                      <ul className="flex flex-wrap gap-1.5" aria-label={text.membersOf(kitchen.name)}>
                        {kitchen.members.map((member) => (
                          <li key={member.personId} className="inline-flex h-11 max-w-full min-w-0 items-center gap-0.5 rounded-full bg-muted pl-4 text-sm md:h-8 md:pr-1 md:pl-3">
                            <span className="truncate">{member.email}</span>
                            <button type="button" className="grid size-11 place-items-center rounded-full hover:bg-background md:size-6" aria-label={text.removeMember(member.email, kitchen.name)} disabled={pending}
                              onClick={() => void run({ type: "member.remove", kitchenId: kitchen.id, personId: member.personId }, text.leftKitchen(member.email, kitchen.name))}>
                              <XIcon className="size-3.5" aria-hidden />
                            </button>
                          </li>
                        ))}
                      </ul>
                      {outside.length ? (
                        <label className="flex items-center gap-2 text-sm">
                          <UserPlusIcon className="size-4 text-muted-foreground" aria-hidden />
                          <span className="sr-only">{text.addPersonTo(kitchen.name)}</span>
                          <select className="h-11 w-0 min-w-0 flex-1 rounded-lg border border-input bg-field px-2 text-sm md:h-9" value="" disabled={pending}
                            onChange={(event) => { const person = outside.find((one) => one.id === event.target.value); if (person) void run({ type: "member.add", kitchenId: kitchen.id, personId: person.id }, text.joined(person.email, kitchen.name)); }}>
                            <option value="">{text.addPerson}</option>
                            {outside.map((person) => <option key={person.id} value={person.id}>{person.email}</option>)}
                          </select>
                        </label>
                      ) : <p className="text-xs text-muted-foreground">{data.people.length ? text.everyoneMember : <>{text.inviteIn} <Link to="/settings" className="underline">{text.settings}</Link> {text.inviteFirst}</>}</p>}
                      <p className="text-xs text-muted-foreground">{text.accessNote}</p>
                    </div>
                  ) : null}
                  <div className="mt-auto flex items-center justify-between gap-2">
                    <Button nativeButton={false} render={<Link to="/kitchen/$kitchenId" params={{ kitchenId: kitchen.id }} />}>{text.open}</Button>
                    {data.isAdmin ? (
                      <Button size="sm" variant="destructive-subtle" disabled={pending} onClick={() => {
                        if (window.confirm(text.deleteConfirm(kitchen.name))) void run({ type: "kitchen.remove", kitchenId: kitchen.id }, text.deleted(kitchen.name));
                      }}><Trash2Icon aria-hidden /> {text.delete}</Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="rounded-2xl border border-dashed border-[color:var(--surface-border)] px-6 py-14 text-center">
            <p className="font-medium">{data.isAdmin ? text.noKitchens : text.notInKitchen}</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              {data.isAdmin ? text.createHint : text.askAdmin}
            </p>
            {data.isAdmin ? <Button className="mt-4" onClick={() => { setName(""); setCreating(true); }}><PlusIcon aria-hidden /> {text.createFirst}</Button> : null}
          </div>
        )}
      </main>
      <KitchenSheet
        open={creating || renaming !== undefined}
        onOpenChange={(next) => { if (!next) { setCreating(false); setRenaming(undefined); } }}
        title={renaming ? text.renameTitle(renaming.name) : text.newKitchen}
        footer={<Button size="lg" className="px-5" disabled={!name.trim() || pending} onClick={async () => {
          const done = renaming
            ? await run({ type: "kitchen.rename", kitchenId: renaming.id, name }, text.renamed)
            : await run({ type: "kitchen.create", name }, text.created(name.trim()));
          if (done) { setCreating(false); setRenaming(undefined); }
        }}>{renaming ? text.renameButton : text.createKitchen}</Button>}
      >
        <form className="pb-2" onSubmit={(event) => event.preventDefault()}>
          <label className="grid gap-1.5 text-sm font-medium">
            {text.name}
            <Input className="h-10" autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={text.namePlaceholder} />
          </label>

        </form>
      </KitchenSheet>
    </>
  );
}

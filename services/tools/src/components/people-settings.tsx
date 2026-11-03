import { useRouter } from "@tanstack/react-router";
import { CheckIcon, Trash2Icon, UserPlusIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { Person } from "../lib/people.js";
import type { GrantableProductId } from "../product-access.js";
import { invitePerson, removePerson, setPersonGrant } from "../people-server-functions.js";
import { TOOLS_PRODUCTS } from "./tools-nav.js";
import { Avatar, AvatarFallback } from "./ui/avatar.js";
import { Badge } from "./ui/badge.js";
import { Button } from "./ui/button.js";
import { Input } from "./ui/input.js";
import { Toggle } from "./ui/toggle.js";

type Product = Readonly<{ id: GrantableProductId; label: string }>;

export function PeopleSettings({ people, products }: { people: readonly Person[]; products: readonly Product[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();

  async function run(key: string, action: () => Promise<unknown>) {
    setPending(key); setError(undefined);
    try {
      await action();
      await router.invalidate();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The change failed.");
      return false;
    } finally { setPending(undefined); }
  }

  async function invite(event: FormEvent) {
    event.preventDefault();
    if (await run("invite", () => invitePerson({ data: { email } }))) setEmail("");
  }

  function remove(person: Person) {
    if (!window.confirm(`Remove ${person.email}? They lose access at once and are signed out. Their data stays, and returns if you invite them again.`)) return;
    void run(person.id, () => removePerson({ data: { personId: person.id } }));
  }

  return (
    <section className="mt-6 max-w-3xl overflow-hidden rounded-xl bg-card ring-1 ring-[color:var(--surface-border)]" aria-labelledby="people-title">
      <header className="flex items-start justify-between gap-4 border-b border-border/60 px-4 py-3.5">
        <span className="min-w-0">
          <strong id="people-title" className="block text-sm font-semibold">People</strong>
          <span className="block text-[0.8125rem] text-muted-foreground">Invite a Google account, then choose the tools it can open. Each person sees only their own data.</span>
        </span>
        {people.length ? <Badge variant="outline" className="mt-0.5">{people.length}</Badge> : null}
      </header>

      {people.length ? (
        <ul className="divide-y divide-border/60">
          {people.map((person) => (
            <li key={person.id} className="grid grid-cols-[minmax(0,1fr)] gap-3 px-4 py-3.5" aria-busy={pending === person.id}>
              <div className="flex min-w-0 items-center gap-3">
                <Avatar className="size-9"><AvatarFallback>{person.email.slice(0, 1).toUpperCase()}</AvatarFallback></Avatar>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-sm font-semibold" title={person.email}>{person.email}</strong>
                  {person.bound
                    ? <Badge variant="positive" className="mt-1">Signed in</Badge>
                    : <Badge variant="warning" className="mt-1">Invited, not signed in yet</Badge>}
                </span>
                <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-negative" aria-label={`Remove ${person.email}`} disabled={Boolean(pending)} onClick={() => remove(person)}>
                  <Trash2Icon />
                </Button>
              </div>
              <div className="flex flex-wrap gap-2 sm:pl-12" role="group" aria-label={`Tools for ${person.email}`}>
                {products.map((product) => {
                  const granted = person.products.includes(product.id);
                  const icon = TOOLS_PRODUCTS.find((item) => item.id === product.id)?.icon;
                  const key = `${person.id}:${product.id}`;
                  return (
                    <Toggle
                      key={product.id}
                      variant="outline"
                      size="sm"
                      pressed={granted}
                      disabled={Boolean(pending)}
                      aria-busy={pending === key}
                      className="rounded-full pl-1.5 text-muted-foreground aria-pressed:border-positive/50 aria-pressed:bg-positive/10 aria-pressed:text-foreground aria-pressed:hover:bg-positive/15"
                      onPressedChange={(next) => void run(key, () => setPersonGrant({ data: { personId: person.id, productId: product.id, granted: next } }))}
                    >
                      {icon ? <img src={icon} alt="" className="size-5 rounded-full" width={20} height={20} /> : null}
                      {product.label}
                      {granted ? <CheckIcon className="text-positive" /> : null}
                    </Toggle>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-5 text-sm text-muted-foreground">Nobody else has access yet. Invite someone below.</p>
      )}

      <form className="flex flex-col gap-2 border-t border-border/60 bg-muted/30 px-4 py-3 sm:flex-row sm:items-center" onSubmit={(event) => void invite(event)}>
        <Input className="min-w-0 sm:flex-1" type="email" inputMode="email" autoComplete="off" required placeholder="name@gmail.com" aria-label="Google email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={Boolean(pending)} />
        <Button type="submit" disabled={Boolean(pending) || !email.trim()}><UserPlusIcon />{pending === "invite" ? "Inviting…" : "Invite"}</Button>
      </form>
      {error ? <p role="alert" className="border-t border-border/60 px-4 py-3 text-sm text-negative">{error}</p> : null}
    </section>
  );
}

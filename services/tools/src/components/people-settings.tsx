import { useRouter } from "@tanstack/react-router";
import { UserPlusIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { Person } from "../lib/people.js";
import type { GrantableProductId } from "../product-access.js";
import { invitePerson, removePerson, setPersonGrant } from "../people-server-functions.js";
import { Button } from "./ui/button.js";
import { Checkbox } from "./ui/checkbox.js";
import { Input } from "./ui/input.js";

type Product = Readonly<{ id: GrantableProductId; label: string }>;

export function PeopleSettings({ people, products }: { people: readonly Person[]; products: readonly Product[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError(undefined);
    try {
      await action();
      await router.invalidate();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The change failed.");
      return false;
    } finally { setBusy(false); }
  }

  async function invite(event: FormEvent) {
    event.preventDefault();
    if (await run(() => invitePerson({ data: { email } }))) setEmail("");
  }

  function remove(person: Person) {
    if (!window.confirm(`Remove ${person.email}? They lose access at once and are signed out.`)) return;
    void run(() => removePerson({ data: { personId: person.id } }));
  }

  return (
    <section className="mt-6 max-w-3xl rounded-xl bg-card ring-1 ring-[color:var(--surface-border)]" aria-label="People">
      <div className="border-b border-border/60 px-4 py-3.5">
        <strong className="block text-sm font-semibold">People</strong>
        <span className="block text-[0.8125rem] text-muted-foreground">Invite a Google account, then choose the tools it can open. Each person sees only their own data.</span>
      </div>
      {people.length ? (
        <ul className="divide-y divide-border/60">
          {people.map((person) => (
            <li key={person.id} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-sm font-semibold">{person.email}</strong>
                <span className="block text-[0.8125rem] text-muted-foreground">{person.bound ? "Signed in" : "Invited, not signed in yet"}</span>
              </span>
              {products.map((product) => (
                <label key={product.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={person.products.includes(product.id)}
                    disabled={busy}
                    onCheckedChange={(granted) => void run(() => setPersonGrant({ data: { personId: person.id, productId: product.id, granted } }))}
                  />
                  {product.label}
                </label>
              ))}
              <Button variant="destructive-subtle" size="sm" disabled={busy} onClick={() => remove(person)}>Remove</Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-3 text-sm text-muted-foreground">Nobody else has access.</p>
      )}
      <form className="flex flex-wrap items-center gap-2 border-t border-border/60 px-4 py-3" onSubmit={(event) => void invite(event)}>
        <Input className="min-w-0 flex-1 basis-56" type="email" required placeholder="name@gmail.com" aria-label="Google email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} />
        <Button type="submit" size="sm" disabled={busy || !email.trim()}><UserPlusIcon />Invite</Button>
      </form>
      {error ? <p role="alert" className="px-4 pb-3 text-sm text-negative">{error}</p> : null}
    </section>
  );
}

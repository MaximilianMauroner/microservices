import { createFileRoute, Link } from "@tanstack/react-router";
import { LogOutIcon, PlugIcon } from "lucide-react";
import type { ReactNode } from "react";
import { requireSignedIn } from "../../platform/auth/session.js";
import { getPeople } from "../../platform/access/people-server-functions.js";
import { PeopleSettings } from "../../platform/access/people-settings.js";
import { authClient } from "../../platform/auth/auth-client.js";
import { formatDate } from "../../platform/ui/lib/format-date.js";
import { useTheme, type ThemePreference } from "../../platform/ui/components/theme-provider.js";
import { AppShell } from "../../platform/ui/components/app-shell.js";
import { PageHeader } from "../../platform/ui/components/page-header.js";
import { Segmented } from "../../platform/ui/components/segmented.js";
import { Avatar, AvatarFallback } from "../../platform/ui/components/ui/avatar.js";
import { Button } from "../../platform/ui/components/ui/button.js";
import { useSidebar } from "../../platform/ui/components/ui/sidebar.js";

export const Route = createFileRoute("/settings")({
  beforeLoad: async ({ location }) => ({ principal: await requireSignedIn(location.href) }),
  loader: async ({ context }) => {
    if (context.principal.role !== "admin") return undefined;
    return { people: await getPeople() };
  },
  head: () => ({ meta: [{ title: "Settings — Mauroner Tools" }] }),
  component: SettingsPage
});

const THEMES = [["light", "Light"], ["dark", "Dark"], ["system", "System"]] as const;
const SIDEBAR = [["open", "Open"], ["icons", "Icons only"]] as const;

function SettingsPage() {
  const admin = Route.useLoaderData();
  const { data: session } = authClient.useSession();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const sidebar = useSidebar();
  const name = session?.user.name || "Account";
  const email = session?.user.email || "Signed in";
  const initials = name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

  async function signOut() {
    await authClient.signOut();
    window.location.assign("/");
  }

  return (
    <>
      <AppShell product="Settings" />
      <main id="main" className="tools-page">
        <PageHeader title="Settings" facts="Your account and how Tools looks on this device" />
        <section className="max-w-3xl divide-y divide-border/60 rounded-xl bg-card ring-1 ring-[color:var(--surface-border)]" aria-label="Settings">
          <SettingRow label="Account" detail="From Google">
            <span className="flex min-w-0 items-center gap-3">
              <Avatar className="size-10"><AvatarFallback>{initials || "A"}</AvatarFallback></Avatar>
              <span className="min-w-0"><strong className="block truncate text-sm font-semibold">{name}</strong><span className="block truncate text-sm text-muted-foreground">{email}</span></span>
            </span>
          </SettingRow>
          <SettingRow label="Appearance" detail="Saved on this device">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Segmented label="Appearance" options={THEMES} value={theme} onValue={(value: ThemePreference) => setTheme(value)} />
              {theme === "system" ? <span className="text-[0.8125rem] text-muted-foreground">System is {resolvedTheme} now</span> : null}
            </span>
          </SettingRow>
          <SettingRow label="Sidebar" detail="Also Ctrl+B or ⌘B">
            <Segmented label="Sidebar" options={SIDEBAR} value={sidebar.open ? "open" : "icons"} onValue={(value) => sidebar.setOpen(value === "open")} />
          </SettingRow>
          <SettingRow label="AI apps" detail="Claude, ChatGPT, Codex, and more">
            <Button nativeButton={false} variant="outline" size="sm" render={<Link to="/connect" preload="intent" />}><PlugIcon />Connect an AI app</Button>
          </SettingRow>
          <SettingRow label="Session" detail={session?.session.expiresAt ? `Ends ${formatDate(session.session.expiresAt)}` : "Signed in"}>
            <Button variant="destructive-subtle" size="sm" onClick={() => void signOut()}><LogOutIcon />Sign out</Button>
          </SettingRow>
        </section>
        {admin ? <PeopleSettings people={admin.people.people} products={admin.people.products} /> : null}
      </main>
    </>
  );
}

function SettingRow({ label, detail, children }: { label: string; detail: string; children: ReactNode }) {
  return (
    <div className="grid items-center gap-x-5 gap-y-2 px-4 py-3.5 sm:grid-cols-[11rem_minmax(0,1fr)]">
      <div><strong className="block text-sm font-semibold">{label}</strong><span className="block text-[0.8125rem] text-muted-foreground">{detail}</span></div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

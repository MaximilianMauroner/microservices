import { createFileRoute } from "@tanstack/react-router";
import { CheckIcon, LaptopIcon, MoonIcon, SunIcon } from "lucide-react";
import { requireRouteSession } from "../auth-session.js";
import { authClient } from "../lib/auth-client.js";
import { useTheme, type ThemePreference } from "../components/theme-provider.js";
import { Avatar, AvatarFallback } from "../components/ui/avatar.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.js";

export const Route = createFileRoute("/settings")({
  beforeLoad: ({ location }) => requireRouteSession(location.href),
  head: () => ({ meta: [{ title: "Settings — Mauroner Tools" }] }),
  component: SettingsPage
});

const choices = [
  { value: "light", label: "Light", description: "A bright background and dark text.", icon: SunIcon },
  { value: "dark", label: "Dark", description: "A low-light interface with high contrast.", icon: MoonIcon },
  { value: "system", label: "System", description: "Follow this device's appearance setting.", icon: LaptopIcon }
] as const;

function SettingsPage() {
  const { data: session } = authClient.useSession();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const name = session?.user.name || "Account";
  const email = session?.user.email || "Signed in";
  const initials = name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-5 py-7 sm:px-8 sm:py-9">
      <header className="mb-6 border-b pb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Account details and appearance for this device.</p>
      </header>

      <div className="grid gap-5">
        <Card size="sm">
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Your identity comes from your Google account and cannot be edited here.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3 rounded-lg border bg-muted/35 p-3">
              <Avatar size="lg" className="size-11"><AvatarFallback>{initials || "A"}</AvatarFallback></Avatar>
              <div className="min-w-0">
                <strong className="block truncate text-sm font-semibold">{name}</strong>
                <span className="block truncate text-sm text-muted-foreground">{email}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>Choose a theme for this browser. System currently resolves to {resolvedTheme}.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Appearance">
              {choices.map(({ value, label, description, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={theme === value}
                  onClick={() => setTheme(value as ThemePreference)}
                  className="relative min-h-28 rounded-lg border bg-background p-3 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-checked:border-primary aria-checked:bg-muted"
                >
                  <Icon className="mb-3 size-5 text-muted-foreground" />
                  <strong className="block text-sm font-semibold">{label}</strong>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span>
                  {theme === value ? <span className="absolute right-3 top-3 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground"><CheckIcon className="size-3.5" /></span> : null}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

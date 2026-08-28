import { Link, useRouterState } from "@tanstack/react-router";
import { ExternalLinkIcon, FileArchiveIcon, FilesIcon, LaptopIcon, LogOutIcon, MoonIcon, MoreVerticalIcon, PlusIcon, SettingsIcon, SunIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { favicons } from "../favicons.js";
import { authClient } from "../lib/auth-client.js";
import { Avatar, AvatarFallback } from "./ui/avatar.js";
import { useTheme, type ThemePreference } from "./theme-provider.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from "./ui/dropdown-menu.js";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  SidebarTrigger
} from "./ui/sidebar.js";

const products = [
  { label: "Dashboard", to: "/", icon: favicons.directory, match: (path: string) => path === "/" },
  { label: "Publisher", to: "/publisher", icon: favicons.publisher, match: (path: string) => path.startsWith("/publisher") },
  { label: "Field Guide", to: "/field-guide", icon: favicons.fieldGuide, match: (path: string) => path.startsWith("/field-guide") },
  { label: "Money", to: "/money", icon: favicons.money, match: (path: string) => path.startsWith("/money") },
  { label: "Feedback", to: "/feedback", icon: favicons.feedback, match: (path: string) => path.startsWith("/feedback") },
  { label: "Status", to: "/status", icon: favicons.status, match: (path: string) => path.startsWith("/status") }
] as const;

export function ToolsSidebar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const search = useRouterState({ select: (state) => state.location.search as Record<string, unknown> });
  const contentRef = useRef<HTMLDivElement>(null);
  const { data: session } = authClient.useSession();
  const { theme, setTheme } = useTheme();
  const userName = session?.user.name || "Account";
  const userEmail = session?.user.email || "Signed in";
  const initials = userName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  async function signOut() {
    await authClient.signOut();
    window.location.assign("/");
  }

  return (
    <Sidebar className="suite-sidebar" collapsible="icon">
      <SidebarHeader className="gap-3 px-3 pb-2 pt-4">
        <div className="flex items-center gap-1">
          <Link className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-sm font-semibold hover:bg-sidebar-accent group-data-[collapsible=icon]:hidden" to="/" preload="intent" aria-label="Tools dashboard">
            <img className="size-7 rounded-lg" src={favicons.directory} alt="" width={28} height={28} />
            <span className="truncate group-data-[collapsible=icon]:hidden">Mauroner Tools</span>
          </Link>
          <SidebarTrigger className="size-8 shrink-0" title="Toggle sidebar" />
        </div>
        <Link
          to="/publisher"
          preload="intent"
          className="flex h-11 min-w-0 items-center gap-2 rounded-xl bg-sidebar-primary px-3 text-sm font-semibold text-sidebar-primary-foreground hover:bg-sidebar-primary/90 group-data-[collapsible=icon]:h-8! group-data-[collapsible=icon]:w-8! group-data-[collapsible=icon]:min-w-8! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:rounded-md group-data-[collapsible=icon]:p-0!"
        >
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-sidebar-primary-foreground text-sidebar-primary"><PlusIcon className="size-3.5" /></span>
          <span className="truncate group-data-[collapsible=icon]:hidden">Publish artifact</span>
        </Link>
      </SidebarHeader>
      <SidebarContent ref={contentRef} className="px-2 py-2">
        <SidebarGroup className="p-1">
          <SidebarGroupLabel className="sr-only">Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {products.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    className="h-10 px-3 text-sm"
                    tooltip={item.label}
                    isActive={item.match(pathname)}
                    render={<Link to={item.to} preload="intent" />}
                  >
                    <img className="size-5 rounded" src={item.icon} alt="" width={20} height={20} />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                  {item.to === "/publisher" && pathname.startsWith("/publisher") ? (
                    <SidebarMenuSub>
                      <SubLink label="Publish" to="/publisher" active={pathname === "/publisher" || pathname === "/publisher/"} />
                      <SubLink label="Published artifacts" to="/publisher/artifacts" active={pathname === "/publisher/artifacts"} />
                    </SidebarMenuSub>
                  ) : null}
                  {item.to === "/field-guide" && pathname.startsWith("/field-guide") ? (
                    <SidebarMenuSub>
                      <SearchSubLink label="Decisions" to="/field-guide" search={{ view: "decisions" }} active={!search.view || search.view === "decisions"} />
                      <SearchSubLink label="Candidates" to="/field-guide" search={{ view: "queue" }} active={search.view === "queue"} />
                      <SearchSubLink label="History" to="/field-guide" search={{ view: "history" }} active={search.view === "history"} />
                    </SidebarMenuSub>
                  ) : null}
                  {item.to === "/money" && pathname.startsWith("/money") ? (
                    <SidebarMenuSub>
                      {(["overview", "accounts", "investments", "cash-flow", "transactions", "categories", "insights", "predictions", "data"] as const).map((view) => (
                        <SearchSubLink
                          key={view}
                          label={view === "cash-flow" ? "Cash flow" : view === "data" ? "Data quality" : `${view[0]!.toUpperCase()}${view.slice(1)}`}
                          to="/money"
                          search={{ view: view === "overview" ? undefined : view }}
                          active={view === "overview" ? !search.view || search.view === "overview" : search.view === view}
                        />
                      ))}
                    </SidebarMenuSub>
                  ) : null}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="mt-5 p-1">
          <SidebarGroupLabel className="px-3 text-xs normal-case tracking-normal">Manage</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              <SidebarMenuItem>
                <SidebarMenuButton className="h-10 px-3 text-sm" tooltip="Published artifacts" isActive={pathname === "/publisher/artifacts"} render={<Link to="/publisher/artifacts" preload="intent" />}>
                  <FileArchiveIcon /><span>Published artifacts</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton className="h-10 px-3 text-sm" tooltip="Markdown documents" isActive={pathname === "/documents"} render={<Link to="/documents" preload="intent" />}>
                  <FilesIcon /><span>Markdown documents</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="mt-2 p-1">
          <SidebarGroupLabel className="px-3 text-xs normal-case tracking-normal">External</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <ExternalItem label="Markdown Share" href="https://markdown-share-alpha.mauroner.workers.dev/" icon={favicons.markdownShare} />
              <ExternalItem label="Network Console" href="https://coding.tailbc92d.ts.net" icon={favicons.networkConsole} />
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-3">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex h-14 w-full min-w-0 items-center gap-3 rounded-xl px-2 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring data-popup-open:bg-sidebar-accent group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
            aria-label="Open account menu"
          >
            <Avatar size="lg" className="size-10">
              <AvatarFallback>{initials || "A"}</AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
              <strong className="block truncate text-sm font-semibold text-sidebar-foreground">{userName}</strong>
              <span className="block truncate text-xs text-muted-foreground">{userEmail}</span>
            </span>
            <MoreVerticalIcon className="size-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" sideOffset={10} className="w-72 rounded-xl p-1.5">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex items-center gap-3 px-2 py-2 font-normal">
                <Avatar size="lg" className="size-10">
                  <AvatarFallback>{initials || "A"}</AvatarFallback>
                </Avatar>
                <span className="min-w-0">
                  <strong className="block truncate text-sm font-semibold text-foreground">{userName}</strong>
                  <span className="block truncate text-xs text-muted-foreground">{userEmail}</span>
                </span>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link to="/settings" preload="intent" />}><SettingsIcon />Settings</DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger><SunIcon />Appearance</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-40">
                <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as ThemePreference)}>
                  <DropdownMenuRadioItem value="light"><SunIcon />Light</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark"><MoonIcon />Dark</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="system"><LaptopIcon />System</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void signOut()}><LogOutIcon />Log out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function SubLink({ label, to, active }: { label: string; to: "/publisher" | "/publisher/artifacts"; active: boolean }) {
  return <SidebarMenuSubItem><SidebarMenuSubButton isActive={active} render={<Link to={to} preload="intent" />}><span>{label}</span></SidebarMenuSubButton></SidebarMenuSubItem>;
}

function SearchSubLink({ label, to, search, active }: { label: string; to: "/field-guide" | "/money"; search: Record<string, unknown>; active: boolean }) {
  return <SidebarMenuSubItem><SidebarMenuSubButton isActive={active} render={<Link to={to} search={search} preload="intent" />}><span>{label}</span></SidebarMenuSubButton></SidebarMenuSubItem>;
}

function ExternalItem({ label, href, icon }: { label: string; href: string; icon: string }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton className="h-10 px-3 text-sm" tooltip={label} render={<a href={href} target="_blank" rel="noreferrer" />}>
        <img className="size-5 rounded" src={icon} alt="" width={20} height={20} />
        <span>{label}</span><ExternalLinkIcon className="ml-auto size-3! opacity-50" />
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

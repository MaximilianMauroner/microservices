import { Link, useRouterState } from "@tanstack/react-router";
import { ExternalLinkIcon, LaptopIcon, LogOutIcon, MoonIcon, MoreVerticalIcon, SettingsIcon, SunIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { favicons } from "../favicons.js";
import { getAttentionSummary, type AttentionSummary } from "../attention.js";
import { MONEY_VIEWS, MoneyReviewBadge, moneyReviewCount, moneyReviewCounts, moneyViewTitle } from "../../money/money-tracker-navigation.js";
import { authClient } from "../lib/auth-client.js";
import { Avatar, AvatarFallback } from "./ui/avatar.js";
import { useTheme, type ThemePreference } from "./theme-provider.js";
import { TOOLS_PRODUCTS, type ToolsPage, type ToolsProduct } from "./tools-nav.js";
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
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar
} from "./ui/sidebar.js";

export function ToolsSidebar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const search = useRouterState({ select: (state) => state.location.search as Record<string, unknown> });
  // The Money route loads fresh review counts with its data; elsewhere the attention summary supplies them.
  const moneyRouteReview = useRouterState({ select: (state) => moneyReviewCounts(state.matches.find((match) => match.routeId === "/money")?.loaderData) });
  const attention = useAttention(pathname);
  const contentRef = useRef<HTMLDivElement>(null);
  const { setOpenMobile } = useSidebar();

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
    setOpenMobile(false);
  }, [pathname]);

  const counts: Partial<Record<ToolsProduct["id"], ReactNode>> = {
    money: countBadge(moneyRouteReview ? moneyReviewCount(moneyRouteReview) : attention?.moneyReview),
    feedback: countBadge(attention?.feedbackUnread),
    markdown: countBadge(attention?.documentsExpiring?.length),
    status: attention?.servicesDown?.length ? <span className="size-2 rounded-full bg-negative" title={`${attention.servicesDown.length} down`} /> : null
  };

  return (
    <Sidebar className="suite-sidebar" collapsible="icon">
      <SidebarHeader className="px-3 pb-1 pt-3">
        <div className="flex items-center gap-1">
          <Link className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-sm font-semibold hover:bg-sidebar-accent group-data-[collapsible=icon]:hidden" to="/" preload="intent" aria-label="Tools dashboard">
            <img className="size-6 rounded-md" src={favicons.directory} alt="" width={24} height={24} />
            <span className="truncate">Tools</span>
          </Link>
          <SidebarTrigger className="size-8 shrink-0" title="Toggle sidebar (Ctrl+B)" />
        </div>
      </SidebarHeader>
      <SidebarContent ref={contentRef} className="px-2 py-1">
        <SidebarGroup className="p-1">
          <SidebarGroupLabel className="sr-only">Tools</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {TOOLS_PRODUCTS.map((product) => {
                const active = product.match(pathname) || Boolean(product.pages?.some((page) => page.match(pathname)));
                return (
                  <SidebarMenuItem key={product.id}>
                    <SidebarMenuButton className="h-9 px-2.5 text-sm" tooltip={product.label} isActive={active && !product.pages} render={<Link to={product.to} preload="intent" />}>
                      <img className="size-5 rounded" src={product.icon} alt="" width={20} height={20} />
                      <span>{product.label}</span>
                    </SidebarMenuButton>
                    {counts[product.id] && !(active && product.pages) ? <SidebarMenuBadge className="top-2 right-2">{counts[product.id]}</SidebarMenuBadge> : null}
                    {active && product.pages ? (
                      <SidebarMenuSub>
                        {product.pages.map((page, index) => <PageLink key={page.to} page={page} active={page.match(pathname)} badge={index === 0 ? counts[product.id] : null} />)}
                      </SidebarMenuSub>
                    ) : null}
                    {product.id === "money" && active ? (
                      <SidebarMenuSub>
                        {MONEY_VIEWS.map((view) => (
                          <SidebarMenuSubItem key={view}>
                            <SidebarMenuSubButton
                              isActive={view === "overview" ? !search.view || search.view === "overview" : search.view === view}
                              render={<Link to="/money" search={{ view: view === "overview" ? undefined : view }} preload="intent" />}
                            >
                              <span>{moneyViewTitle(view)}</span>
                              {view === "review" && moneyRouteReview && moneyReviewCount(moneyRouteReview) ? <MoneyReviewBadge count={moneyReviewCount(moneyRouteReview)} /> : null}
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    ) : null}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="mt-3 p-1">
          <SidebarGroupLabel className="px-2.5 text-xs normal-case tracking-normal">External</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton className="h-9 px-2.5 text-sm" tooltip="Network Console" render={<a href="https://coding.tailbc92d.ts.net" target="_blank" rel="noreferrer" />}>
                  <img className="size-5 rounded" src={favicons.networkConsole} alt="" width={20} height={20} />
                  <span>Network Console</span><ExternalLinkIcon className="ml-auto size-3! opacity-50" />
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-2">
        <AccountMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function PageLink({ page, active, badge }: { page: ToolsPage; active: boolean; badge: ReactNode }) {
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton isActive={active} render={page.external ? <a href={page.to} target="_blank" rel="noreferrer" /> : <Link to={page.to} preload="intent" />}>
        <span>{page.label}</span>
        {page.external ? <ExternalLinkIcon className="ml-auto size-3! opacity-50" /> : badge ? <span className="ml-auto">{badge}</span> : null}
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}

function countBadge(count: number | undefined) {
  return count ? <MoneyReviewBadge count={count} /> : null;
}

/** Loads the attention counts after hydration and again after each navigation. */
function useAttention(pathname: string) {
  const [summary, setSummary] = useState<AttentionSummary>();
  useEffect(() => {
    let current = true;
    getAttentionSummary().then((next) => { if (current) setSummary(next); }, () => undefined);
    return () => { current = false; };
  }, [pathname]);
  return summary;
}

function AccountMenu() {
  const { data: session } = authClient.useSession();
  const { theme, setTheme } = useTheme();
  const userName = session?.user.name || "Account";
  const userEmail = session?.user.email || "Signed in";
  const initials = userName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

  async function signOut() {
    await authClient.signOut();
    window.location.assign("/");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex h-12 w-full min-w-0 items-center gap-2.5 rounded-lg px-1.5 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring data-popup-open:bg-sidebar-accent group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:p-0"
        aria-label="Open account menu"
      >
        <Avatar className="size-8 shrink-0"><AvatarFallback>{initials || "A"}</AvatarFallback></Avatar>
        <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
          <strong className="block truncate text-sm font-semibold text-sidebar-foreground">{userName}</strong>
          <span className="block truncate text-xs text-muted-foreground">{userEmail}</span>
        </span>
        <MoreVerticalIcon className="size-4 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" sideOffset={10} className="w-64 rounded-xl p-1.5">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 py-1.5 font-normal">
            <strong className="block truncate text-sm font-semibold text-foreground">{userName}</strong>
            <span className="block truncate text-xs text-muted-foreground">{userEmail}</span>
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
        <DropdownMenuItem onClick={() => void signOut()}><LogOutIcon />Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

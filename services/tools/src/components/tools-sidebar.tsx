import { Link, useRouterState } from "@tanstack/react-router";
import { ExternalLinkIcon, FileArchiveIcon, FilesIcon, InboxIcon, LogOutIcon, PlusIcon } from "lucide-react";
import { favicons } from "../favicons.js";
import { authClient } from "../lib/auth-client.js";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar.js";
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
  const { data: session } = authClient.useSession();
  const userName = session?.user.name || "Account";
  const userEmail = session?.user.email || "Signed in";
  const initials = userName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

  async function signOut() {
    await authClient.signOut();
    window.location.assign("/");
  }

  return (
    <Sidebar className="suite-sidebar" collapsible="icon">
      <SidebarHeader className="gap-3 border-b border-sidebar-border px-3 py-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip="Tools dashboard"
              isActive={pathname === "/"}
              render={<Link to="/" preload="intent" aria-label="Tools dashboard" />}
            >
              <img className="size-8 rounded-lg" src={favicons.directory} alt="" width={32} height={32} />
              <span className="text-base font-semibold">Mauroner Tools</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="flex gap-2 group-data-[collapsible=icon]:block">
          <SidebarMenuButton
            size="lg"
            tooltip="Publish artifact"
            className="h-12 flex-1 bg-sidebar-primary px-3 text-base text-sidebar-primary-foreground hover:bg-sidebar-primary/90 hover:text-sidebar-primary-foreground group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2!"
            render={<Link to="/publisher" preload="intent" />}
          >
            <PlusIcon className="rounded-full bg-sidebar-primary-foreground p-0.5 text-sidebar-primary" />
            <span>Publish artifact</span>
          </SidebarMenuButton>
          <SidebarMenuButton
            tooltip="Published artifacts"
            className="size-12 w-12 shrink-0 justify-center border border-sidebar-border group-data-[collapsible=icon]:mt-2 group-data-[collapsible=icon]:size-8!"
            isActive={pathname === "/publisher/artifacts"}
            render={<Link to="/publisher/artifacts" preload="intent" aria-label="Published artifacts" />}
          >
            <InboxIcon />
          </SidebarMenuButton>
        </div>
      </SidebarHeader>
      <SidebarContent className="px-2 py-3">
        <SidebarGroup className="p-1">
          <SidebarGroupLabel className="sr-only">Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {products.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    className="h-11 px-3 text-[0.95rem]"
                    tooltip={item.label}
                    isActive={item.match(pathname)}
                    render={<Link to={item.to} preload="intent" />}
                  >
                    <img className="size-5 rounded" src={item.icon} alt="" width={20} height={20} />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup className="mt-7 p-1">
          <SidebarGroupLabel className="px-3 text-xs normal-case tracking-normal">Manage</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              <SidebarMenuItem>
                <SidebarMenuButton className="h-11 px-3 text-[0.95rem]" tooltip="Published artifacts" isActive={pathname === "/publisher/artifacts"} render={<Link to="/publisher/artifacts" preload="intent" />}>
                  <FileArchiveIcon /><span>Published artifacts</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton className="h-11 px-3 text-[0.95rem]" tooltip="Markdown documents" isActive={pathname === "/documents"} render={<Link to="/documents" preload="intent" />}>
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
      <SidebarFooter className="gap-2 border-t border-sidebar-border p-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-2 group-data-[collapsible=icon]:px-0">
              <Avatar size="lg" className="size-10">
                {session?.user.image ? <AvatarImage src={session.user.image} alt="" /> : null}
                <AvatarFallback>{initials || "A"}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                <strong className="block truncate text-sm font-semibold text-sidebar-foreground">{userName}</strong>
                <span className="block truncate text-xs text-muted-foreground">{userEmail}</span>
              </div>
              <button className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:hidden" type="button" aria-label="Sign out" title="Sign out" onClick={() => void signOut()}>
                <LogOutIcon className="size-4" />
              </button>
            </div>
            <button className="hidden size-8 place-items-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:grid" type="button" aria-label="Sign out" title="Sign out" onClick={() => void signOut()}>
              <LogOutIcon className="size-4" />
            </button>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarTrigger className="w-full justify-start gap-2 px-2 group-data-[collapsible=icon]:size-8!" title="Collapse sidebar"><span className="group-data-[collapsible=icon]:hidden">Collapse sidebar</span></SidebarTrigger>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function ExternalItem({ label, href, icon }: { label: string; href: string; icon: string }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton className="h-11 px-3 text-[0.95rem]" tooltip={label} render={<a href={href} target="_blank" rel="noreferrer" />}>
        <img className="size-5 rounded" src={icon} alt="" width={20} height={20} />
        <span>{label}</span><ExternalLinkIcon className="ml-auto size-3! opacity-50" />
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

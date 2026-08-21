import { Link, useLocation } from "wouter";
import { LayoutDashboard, Boxes, History, PlusSquare, BarChart3, LogOut, Sun, Moon, Menu, X, Trash2, TrendingUp, ScanLine, Scissors, MessageSquareWarning, Play, ShieldCheck, PanelLeftClose, PanelLeftOpen, UserCog, ShieldAlert, GitBranch, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/auth-context";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { AppLogo } from "@/components/AppLogo";
import { appConfig } from "@/lib/appConfig";
import { LicenseBadge } from "@/licensing/LicenseBadge";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: string[];
}

function userHasAnyRole(user: { role: string } | null, roles: string[]): boolean {
  return user !== null && roles.includes(user.role);
}

export function Layout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Desktop-only: minimize to an icon-only rail. Persists across reloads.
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sidebar_collapsed") === "1");

  useEffect(() => {
    localStorage.setItem("sidebar_collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === "adm_broadcasts") {
        window.dispatchEvent(new CustomEvent("admin-broadcast", { detail: e.newValue }));
      }
    };
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("storage", handler);
    };
  }, []);

  const NAV_ENTRIES: NavItem[] = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard, roles: ["supervisor", "qa", "operator"] },
    { href: "/feeder/sessions/new", label: "New Session", icon: PlusSquare, roles: ["supervisor", "operator", "qa", "admin"] },
    { href: "/feeder/sessions/active", label: "Active Sessions", icon: Play, roles: ["supervisor", "operator", "qa", "admin"] },
    { href: "/feeder/qa-queue", label: "QA Queue", icon: ShieldCheck, roles: ["qa", "supervisor"] },
    { href: "/feeder/qa-rejections", label: "QA Rejections", icon: ShieldAlert, roles: ["qa", "supervisor", "admin"] },
    { href: "/feeder/bypass-tracking", label: "Bypass Tracking", icon: GitBranch, roles: ["qa", "supervisor", "admin"] },
    { href: "/feeder/monitoring", label: "Monitoring & Audit", icon: Activity, roles: ["admin"] },
    { href: "/feeder/approvers", label: "Manage Approvers", icon: UserCog, roles: ["qa", "supervisor", "admin"] },
    { href: "/feeder/sessions/history", label: "Session History", icon: History, roles: ["supervisor", "operator", "qa", "admin"] },
    { href: "/bom", label: "BOM Manager", icon: Boxes, roles: ["supervisor"] },
    { href: "/analytics", label: "Analytics", icon: BarChart3, roles: ["supervisor", "qa"] },
    { href: "/real-time-dashboard", label: "Real-Time Dashboard", icon: TrendingUp, roles: ["supervisor", "qa"] },
    { href: "/trash", label: "Trash Bin", icon: Trash2, roles: ["supervisor"] },
  ];

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground flex-col md:flex-row">
      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed md:static inset-y-0 left-0 z-50 w-64 border-r border-border bg-sidebar text-sidebar-foreground flex flex-col shrink-0 transition-all duration-300 transform md:transform-none",
        collapsed && "md:w-16",
        sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
      )}>
        <div className={cn(
          "h-16 flex items-center px-4 md:px-6 border-b border-sidebar-border bg-sidebar",
          collapsed ? "md:justify-center md:px-0" : "justify-between"
        )}>
          <div className={cn("flex items-center gap-2 flex-1 min-w-0", collapsed && "md:hidden")}>
            <AppLogo className="h-10 w-10 flex-shrink-0" />
            <span className="font-mono font-bold tracking-tight text-sm text-sidebar-primary hidden sm:inline truncate">
              {appConfig.systemTitle}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground rounded-full md:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="w-4 h-4" />
          </Button>
          {/* Desktop controls: theme, minimize (icon-rail), hide */}
          <div className="hidden md:flex items-center gap-1">
            {!collapsed && (
              <Button
                variant="ghost"
                size="icon"
                className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground rounded-full"
                onClick={() => setTheme(theme === "light" ? "dark" : "light")}
                title="Toggle theme"
              >
                {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground rounded-full"
              onClick={() => setCollapsed(!collapsed)}
              title={collapsed ? "Expand sidebar" : "Minimize sidebar"}
            >
              {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {user && (
          <div className={cn("p-3 md:p-4 border-b border-sidebar-border bg-sidebar-accent/50", collapsed && "md:hidden")}>
            <div className="flex flex-col min-w-0">
              <span className="font-bold text-sm truncate">{user.name}</span>
              <span className="text-xs text-sidebar-foreground/70 uppercase tracking-wider">{user.role}</span>
            </div>
          </div>
        )}

        <nav className="flex-1 py-4 flex flex-col gap-1 px-2 md:px-3 overflow-y-auto overflow-x-hidden">
          {NAV_ENTRIES.map((item) => {
            if (!userHasAnyRole(user, item.roles)) return null;

            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href + "/"));
            return (
              <Tooltip key={item.href} delayDuration={0}>
                <TooltipTrigger asChild>
                  <Link
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer transition-colors text-sm font-medium whitespace-nowrap",
                      collapsed && "md:justify-center md:px-2",
                      isActive
                        ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                        : "text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                    )}
                    data-testid={`nav-${item.label.toLowerCase().replace(" ", "-")}`}
                    onClick={() => setSidebarOpen(false)}
                  >
                    <item.icon className="w-4 h-4 flex-shrink-0" />
                    <span className={cn("truncate flex-1", collapsed && "md:hidden")}>{item.label}</span>
                  </Link>
                </TooltipTrigger>
                {/* Tooltip only useful when the label is hidden (icon-only rail) */}
                {collapsed && (
                  <TooltipContent side="right" className="hidden md:block">
                    {item.label}
                  </TooltipContent>
                )}
              </Tooltip>
            );
          })}
        </nav>

        {user && (
          <div className="p-3 md:p-4 border-t border-sidebar-border space-y-2">
            <div className={cn(collapsed && "md:hidden")}>
              <LicenseBadge />
            </div>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  className={cn(
                    "w-full flex items-center gap-3 text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent text-sm whitespace-nowrap",
                    collapsed ? "md:justify-center md:px-2" : "justify-start"
                  )}
                  onClick={logout}
                >
                  <LogOut className="w-4 h-4 flex-shrink-0" />
                  <span className={cn("truncate", collapsed && "md:hidden")}>Logout</span>
                </Button>
              </TooltipTrigger>
              {collapsed && (
                <TooltipContent side="right" className="hidden md:block">
                  Logout
                </TooltipContent>
              )}
            </Tooltip>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Mobile Header */}
        <div className="md:hidden h-14 border-b border-border bg-background flex items-center justify-between px-4 sticky top-0 z-30">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="w-5 h-5" />
          </Button>
          <div className="flex-1 px-2">
            <div className="flex items-center justify-center gap-2 min-w-0">
              <AppLogo className="h-6 w-6 flex-shrink-0" />
              <span className="text-center font-semibold text-sm truncate">{appConfig.companyShort}</span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          >
            {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </Button>
        </div>
        {children}
      </main>
    </div>
  );
}

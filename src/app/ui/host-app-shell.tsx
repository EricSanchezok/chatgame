"use client";

import Link from "next/link";
import { BookOpen, ChevronLeft, ChevronRight, Gamepad2, History, Library, Menu, Settings } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";

type ShellSection = "home" | "scripts" | "settings";

export interface HostAppShellProps {
  active: ShellSection;
  script?: { name: string; description?: string } | null;
  status?: ReactNode;
  statusVisible?: boolean;
  recentCount?: number;
  onOpenRecent?(): void;
  children: ReactNode;
}

const navigation = [
  { id: "home", href: "/", label: "游戏首页", icon: Gamepad2 },
  { id: "scripts", href: "/scripts", label: "剧本库", icon: Library },
  { id: "settings", href: "/settings", label: "设置", icon: Settings },
] as const;

interface ShellSidebarProps extends Pick<HostAppShellProps, "active" | "script" | "recentCount" | "onOpenRecent"> {
  collapsed: boolean;
  onToggle(): void;
  onNavigate?(): void;
}

function ShellSidebar({ active, script, recentCount = 0, onOpenRecent, collapsed, onToggle, onNavigate }: ShellSidebarProps) {
  return (
    <aside className="cg-shell-sidebar" data-collapsed={collapsed ? "true" : "false"} aria-label="主导航">
      <header className="cg-shell-sidebar__header">
        <Link href="/" className="cg-shell-brand" aria-label="Chatgame 游戏首页" onClick={onNavigate}>
          <span aria-hidden="true">C</span>
          <strong>Chatgame</strong>
        </Link>
      </header>

      <div className="cg-shell-sidebar__content">
        {script ? (
          <section className="cg-shell-script" aria-label="当前剧本">
            <div className="cg-shell-section-label">当前剧本</div>
            <div className="cg-shell-script__card">
              <span className="cg-shell-script__mark" aria-hidden="true"><BookOpen /></span>
              <span className="cg-shell-script__copy"><strong>{script.name}</strong>{script.description ? <span>{script.description}</span> : null}</span>
            </div>
          </section>
        ) : null}

        <section className="cg-shell-nav-group" aria-label="导航">
          <div className="cg-shell-section-label">导航</div>
          <nav className="cg-shell-nav" aria-label="页面导航">
            {navigation.map(({ id, href, label, icon: Icon }) => (
              <Link key={id} href={href} className="cg-shell-nav__item" data-active={active === id ? "true" : "false"} aria-label={label} title={label} onClick={onNavigate}>
                <Icon aria-hidden="true" />
                <span>{label}</span>
              </Link>
            ))}
            <button
              type="button"
              className="cg-shell-nav__item"
              disabled={!onOpenRecent || recentCount === 0}
              title={recentCount > 0 ? `${recentCount} 个最近存档` : "尚无最近存档"}
              onClick={() => { onOpenRecent?.(); onNavigate?.(); }}
            >
              <History aria-hidden="true" />
              <span>最近存档{recentCount > 0 ? ` · ${recentCount}` : ""}</span>
            </button>
          </nav>
        </section>

      </div>

      <footer className="cg-shell-sidebar__footer">
        <button type="button" className="cg-shell-collapse" onClick={onToggle} aria-label={collapsed ? "展开侧栏" : "折叠侧栏"}>
          {collapsed ? <ChevronRight aria-hidden="true" /> : <ChevronLeft aria-hidden="true" />}
          <span>{collapsed ? "展开侧栏" : "折叠侧栏"}</span>
        </button>
      </footer>
    </aside>
  );
}

export function HostAppShell({ active, script, status, statusVisible = false, recentCount, onOpenRecent, children }: HostAppShellProps) {
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const toggleCollapsed = () => setCollapsed((value) => !value);
  const sidebarProps = { active, script, recentCount, onOpenRecent };

  return (
    <div className="cg-app-shell" data-sidebar-state={collapsed ? "collapsed" : "expanded"}>
      <a className="cg-skip-link" href="#cg-main">跳到主要内容</a>
      {isMobile ? (
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="cg-mobile-shell-sheet" showCloseButton>
            <SheetHeader className="cg-sr-only">
              <SheetTitle>导航</SheetTitle>
              <SheetDescription>当前剧本、页面与游戏资料。</SheetDescription>
            </SheetHeader>
            <ShellSidebar {...sidebarProps} collapsed={false} onToggle={() => setMobileOpen(false)} onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>
      ) : (
        <ShellSidebar {...sidebarProps} collapsed={collapsed} onToggle={toggleCollapsed} />
      )}
      <main id="cg-main" className="cg-shell-main">
        {isMobile ? <button type="button" className="cg-mobile-nav-trigger" onClick={() => setMobileOpen(true)} aria-label="打开导航"><Menu aria-hidden="true" /></button> : null}
        {children}
        {status ? <p className={statusVisible ? "cg-shell-status" : "cg-sr-only"} role="status" aria-live="polite">{status}</p> : null}
      </main>
    </div>
  );
}

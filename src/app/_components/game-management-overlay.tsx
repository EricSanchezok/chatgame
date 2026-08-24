"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { LibraryBig, Settings, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useGameSession } from "./game-session-context";

export function GameManagementOverlay({
  children,
  sessionId,
}: {
  children: ReactNode;
  sessionId: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { session } = useGameSession();
  const gameHref = `/play/${encodeURIComponent(sessionId)}`;
  const manageHref = `${gameHref}/manage`;
  const items = [
    { href: `${manageHref}/saves`, icon: LibraryBig, label: "存档" },
    { href: `${manageHref}/settings`, icon: Settings, label: "设置" },
  ] as const;

  return (
    <Dialog.Root open onOpenChange={(next) => { if (!next) router.replace(gameHref); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="cg-game-manage__overlay" />
        <Dialog.Content
          aria-describedby="cg-game-manage-description"
          className="cg-game-manage"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            window.setTimeout(() => {
              document.querySelector<HTMLButtonElement>("[data-cg-orb-trigger]")?.focus();
            }, 0);
          }}
        >
          <Dialog.Description className="cg-sr-only" id="cg-game-manage-description">
            在不离开当前游戏的情况下管理当前世界的存档和阅读设置。
          </Dialog.Description>
          <aside className="cg-game-manage__sidebar">
            <div>
              <p className="cg-eyebrow">{session.world.name}</p>
              <Dialog.Title className="cg-game-manage__title">游戏管理</Dialog.Title>
              <p>{session.title}</p>
            </div>
            <nav aria-label="游戏管理">
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link aria-current={pathname === item.href ? "page" : undefined} href={item.href} key={item.href}>
                    <Icon aria-hidden="true" />{item.label}
                  </Link>
                );
              })}
            </nav>
            <Dialog.Close asChild>
              <button className="cg-game-manage__return" type="button">返回对话</button>
            </Dialog.Close>
          </aside>
          <div className="cg-game-manage__content">{children}</div>
          <Dialog.Close aria-label="关闭游戏管理" className="cg-game-manage__close">
            <X aria-hidden="true" />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ReactBridge } from "./lib/react-bridge";
import { PlayerPreferenceSync } from "./ui/preference-sync";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chatgame · 剧本驱动的 AI 聊天游戏",
  description: "沉浸聊天式 AI 游戏框架：剧本、主题、资产全部可插拔。",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="flex h-dvh min-h-0 flex-col overflow-hidden">
        <ReactBridge />
        <PlayerPreferenceSync />
        {children}
      </body>
    </html>
  );
}

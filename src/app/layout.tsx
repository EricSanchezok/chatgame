import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chatgame · 剧本驱动的 AI 聊天游戏",
  description: "沉浸聊天式 AI 游戏框架：剧本、主题、资产全部可插拔。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="flex h-dvh min-h-0 flex-col overflow-hidden">{children}</body>
    </html>
  );
}

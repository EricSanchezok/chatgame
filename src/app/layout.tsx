import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PreferenceBridge } from "./_components/preference-bridge";
import "./globals.css";

export const metadata: Metadata = {
  title: "Living World Engine · 世界在等待你的下一句话",
  description: "剧本驱动、自由行动、只在本地持续生长的开放世界游戏。",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <PreferenceBridge />
        {children}
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import type { ReactNode } from "react";
import { PreferenceBridge } from "./_components/preference-bridge";
import { ThemeProvider } from "./_components/theme-provider";
import "./globals.css";

const inter = Inter({
  axes: ["opsz"],
  subsets: ["latin"],
  variable: "--font-inter",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-ibm-plex-mono",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Living World Engine · 世界在等待你的下一句话",
  description: "剧本驱动、自由行动、只在本地持续生长的开放世界游戏。",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className={`${inter.variable} ${ibmPlexMono.variable} antialiased`}>
        <ThemeProvider>
          <PreferenceBridge />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}

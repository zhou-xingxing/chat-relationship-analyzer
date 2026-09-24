import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chat Relationship Analyzer",
  description: "Paste a conversation. See the interaction patterns.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // 宿主浏览器可能在水合前给根节点注入字体变量；只忽略 html 自身的属性差异。
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}

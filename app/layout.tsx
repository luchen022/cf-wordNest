import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WordNest · 我的单词手账",
  description: "多用户英语单词学习平台，支持多词表、AI 助教与知识图谱。",
};

// Applied before first paint so the stored theme does not flash.
const THEME_BOOTSTRAP = `try{var t=localStorage.getItem("wordnest-theme");if(t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme: dark)").matches)){document.documentElement.classList.add("dark")}}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        {/* Runs before the rest of the body paints, so the stored theme never flashes. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
        {children}
      </body>
    </html>
  );
}

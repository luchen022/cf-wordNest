"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { logoutAction } from "@/app/actions/auth";
import { switchListAction } from "@/app/actions/lists";
import { ThemeToggle } from "@/components/ThemeToggle";

interface ListOption {
  id: number;
  name: string;
  word_count: number;
}

const LINKS = [
  { href: "/", label: "练习", icon: "🎯" },
  { href: "/words", label: "词表", icon: "📚" },
  { href: "/graph", label: "图谱", icon: "🕸️" },
  { href: "/tutor", label: "AI 助教", icon: "🤖" },
];

export function NavBar({
  username,
  role,
  lists,
  currentListId,
}: {
  username: string;
  role: "admin" | "user";
  lists: ListOption[];
  currentListId: number;
  markedOnly: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);

  const links = role === "admin" ? [...LINKS, { href: "/admin", label: "用户", icon: "🛡️" }] : LINKS;

  function onSwitchList(value: string) {
    const listId = Number(value);
    if (!Number.isInteger(listId) || listId === currentListId) return;
    startTransition(async () => {
      await switchListAction(listId);
      router.refresh();
    });
  }

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-base font-semibold">
          <span aria-hidden>🪺</span>
          <span>WordNest</span>
        </Link>

        <nav className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
          {links.map((link) => {
            const active =
              link.href === "/" ? pathname === "/" : pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  active
                    ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
              >
                <span aria-hidden>{link.icon}</span>
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <select
            aria-label="选择词表"
            className="field w-auto max-w-[10rem] py-1.5 text-sm"
            value={currentListId}
            disabled={pending}
            onChange={(event) => onSwitchList(event.target.value)}
          >
            {lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}（{list.word_count}）
              </option>
            ))}
          </select>

          <ThemeToggle />

          <div className="relative">
            <button
              type="button"
              className="btn-secondary px-2.5"
              onClick={() => setMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <span aria-hidden>👤</span>
              <span className="hidden sm:inline">{username}</span>
            </button>

            {menuOpen ? (
              <div
                className="card absolute right-0 mt-2 w-44 p-1.5"
                role="menu"
                onMouseLeave={() => setMenuOpen(false)}
              >
                <Link
                  href="/settings"
                  className="block rounded-lg px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                  onClick={() => setMenuOpen(false)}
                >
                  设置
                </Link>
                <div className="my-1 border-t border-slate-200 dark:border-slate-800" />
                <form action={logoutAction}>
                  <button
                    type="submit"
                    className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                  >
                    退出登录
                  </button>
                </form>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}

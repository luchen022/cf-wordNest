"use client";

import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    setMounted(true);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("wordnest-theme", next ? "dark" : "light");
    } catch {
      // Storage can be unavailable in private modes; the toggle still works.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="切换深色模式"
      title="切换深色模式"
      className="btn-secondary px-2.5"
    >
      <span aria-hidden>{mounted && dark ? "🌙" : "☀️"}</span>
    </button>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { setMarkedOnlyAction } from "@/app/actions/lists";
import { toggleMarkAction } from "@/app/actions/words";

interface Definition {
  id: number;
  part_of_speech: string;
  meaning: string;
  example: string;
  note: string;
}

interface WordDetail {
  id: number;
  word: string;
  marked: boolean;
  definitions: Definition[];
}

interface QuizResponse {
  wordId?: number;
  word?: string;
  empty?: boolean;
  reason?: string;
  error?: string;
}

export function QuizPanel({
  encouragement,
  initialMarkedOnly,
  empty,
}: {
  encouragement: string;
  initialMarkedOnly: boolean;
  empty: boolean;
}) {
  const [wordId, setWordId] = useState<number | null>(null);
  const [word, setWord] = useState("");
  const [detail, setDetail] = useState<WordDetail | null>(null);
  const [marked, setMarked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [emptyReason, setEmptyReason] = useState(empty ? "list_empty" : "");
  const [markedOnly, setMarkedOnly] = useState(initialMarkedOnly);
  const previousWord = useRef("");

  const next = useCallback(async () => {
    setLoading(true);
    setError("");
    setDetail(null);
    try {
      const query = previousWord.current ? `?prev=${encodeURIComponent(previousWord.current)}` : "";
      const response = await fetch(`/api/quiz/next${query}`, { cache: "no-store" });
      const data = (await response.json()) as QuizResponse;

      if (data.empty) {
        setWordId(null);
        setWord("");
        setEmptyReason(data.reason ?? "list_empty");
        return;
      }
      if (data.error || typeof data.wordId !== "number" || !data.word) {
        setError(data.error ?? "获取单词失败，请重试");
        return;
      }

      setEmptyReason("");
      previousWord.current = data.word;
      setWordId(data.wordId);
      setWord(data.word);
      setMarked(false);
    } catch {
      setError("网络请求失败，请重试");
    } finally {
      setLoading(false);
    }
  }, []);

  const reveal = useCallback(async () => {
    if (!wordId || detail) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/words/${wordId}`, { cache: "no-store" });
      const data = (await response.json()) as (WordDetail | { error: string }) & { error?: string };
      if (data.error) {
        setError(data.error);
        return;
      }
      setDetail(data as WordDetail);
      setMarked(Boolean((data as WordDetail).marked));
    } catch {
      setError("加载释义失败");
    } finally {
      setLoading(false);
    }
  }, [wordId, detail]);

  const toggleMark = useCallback(async () => {
    if (!wordId) return;
    const nextMarked = !marked;
    setMarked(nextMarked);
    const result = await toggleMarkAction(wordId, nextMarked);
    if (!result.ok) {
      setMarked(!nextMarked);
      setError(result.error ?? "操作失败");
    }
  }, [wordId, marked]);

  const flipMarkedOnly = useCallback(async () => {
    const nextValue = !markedOnly;
    setMarkedOnly(nextValue);
    await setMarkedOnlyAction(nextValue);
    previousWord.current = "";
    void next();
  }, [markedOnly, next]);

  useEffect(() => {
    void next();
  }, [next]);

  // Keyboard shortcuts: space reveals, arrow keys move on.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;

      if (event.code === "Space") {
        event.preventDefault();
        if (detail) void next();
        else void reveal();
      }
      if (event.key === "ArrowRight") void next();
      if (event.key === "m" || event.key === "M") void toggleMark();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail, next, reveal, toggleMark]);

  if (emptyReason === "list_empty") {
    return (
      <div className="card p-10 text-center">
        <div className="text-4xl">📥</div>
        <h2 className="mt-4 text-lg font-semibold">当前词表还是空的</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          先添加一些单词，或切换到其它词表
        </p>
        <Link href="/words" className="btn-primary mt-6">
          去添加单词
        </Link>
      </div>
    );
  }

  if (emptyReason === "no_marked") {
    return (
      <div className="card p-10 text-center">
        <div className="text-4xl">⭐</div>
        <h2 className="mt-4 text-lg font-semibold">没有已标注的单词</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          当前只抽查已标注的单词，但还没有任何标注
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button type="button" className="btn-primary" onClick={() => void flipMarkedOnly()}>
            抽查全部单词
          </button>
          <Link href="/words" className="btn-secondary">
            去标注
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card flex flex-col items-center px-6 py-12">
        <p className="text-sm text-slate-400 dark:text-slate-500">{encouragement}</p>

        <div className="mt-8 flex min-h-[7rem] items-center justify-center">
          <span
            className={`text-center text-5xl font-semibold tracking-tight transition-opacity sm:text-6xl ${
              loading ? "opacity-40" : "opacity-100"
            }`}
          >
            {word || "…"}
          </span>
        </div>

        {error ? (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        ) : null}

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button type="button" className="btn-primary" onClick={() => void reveal()} disabled={!wordId || loading}>
            {detail ? "已显示释义" : "显示释义"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              if (typeof window !== "undefined" && word) {
                const utterance = new SpeechSynthesisUtterance(word);
                utterance.lang = "en-US";
                window.speechSynthesis.speak(utterance);
              }
            }}
            disabled={!word}
            title="朗读单词"
          >
            🔊 发音
          </button>
          <button type="button" className="btn-secondary" onClick={() => void toggleMark()} disabled={!wordId}>
            {marked ? "⭐ 已标注" : "☆ 标注"}
          </button>
          <button type="button" className="btn-secondary" onClick={() => void next()} disabled={loading}>
            下一个 →
          </button>
        </div>

        <p className="mt-6 text-xs text-slate-400 dark:text-slate-500">
          快捷键：空格显示 / 右方向键下一个 / M 标注
        </p>
      </div>

      <div className="flex items-center justify-between">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            className="size-4 rounded border-slate-300 text-indigo-600"
            checked={markedOnly}
            onChange={() => void flipMarkedOnly()}
          />
          只抽查已标注的单词
        </label>
      </div>

      {detail ? (
        <div className="card divide-y divide-slate-200 dark:divide-slate-800">
          {detail.definitions.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">这个单词还没有释义</p>
          ) : (
            detail.definitions.map((definition) => (
              <div key={definition.id} className="space-y-2 p-6">
                <div className="flex items-center gap-2">
                  <span className="chip bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                    {definition.part_of_speech}
                  </span>
                  <span className="text-base font-medium">{definition.meaning}</span>
                </div>
                {definition.example ? (
                  <p className="whitespace-pre-line text-sm text-slate-600 dark:text-slate-300">
                    {definition.example}
                  </p>
                ) : null}
                {definition.note ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">💡 {definition.note}</p>
                ) : null}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

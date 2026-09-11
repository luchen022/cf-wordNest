"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteWordAction, saveWordAction, toggleMarkAction } from "@/app/actions/words";
import { PARTS_OF_SPEECH } from "@/lib/constants";

interface DefinitionDraft {
  part_of_speech: string;
  meaning: string;
  example: string;
  note: string;
}

interface WordEntry {
  id: number;
  word: string;
  marked: boolean;
  definitions: Array<DefinitionDraft & { id: number }>;
}

interface EditorState {
  id: number | null;
  word: string;
  definitions: DefinitionDraft[];
}

const emptyDefinition = (): DefinitionDraft => ({
  part_of_speech: "n.",
  meaning: "",
  example: "",
  note: "",
});

export function WordManager({ listId, initialWords }: { listId: number; initialWords: WordEntry[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [markedOnly, setMarkedOnly] = useState(false);
  const [alphabetical, setAlphabetical] = useState(true);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = initialWords.filter((entry) => {
      if (markedOnly && !entry.marked) return false;
      if (!needle) return true;
      if (entry.word.toLowerCase().includes(needle)) return true;
      return entry.definitions.some((definition) => definition.meaning.toLowerCase().includes(needle));
    });

    return [...filtered].sort((a, b) =>
      alphabetical ? a.word.localeCompare(b.word, "en", { sensitivity: "base" }) : a.id - b.id,
    );
  }, [initialWords, search, markedOnly, alphabetical]);

  function openCreate() {
    setMessage(null);
    setEditor({ id: null, word: "", definitions: [emptyDefinition()] });
  }

  function openEdit(entry: WordEntry) {
    setMessage(null);
    setEditor({
      id: entry.id,
      word: entry.word,
      definitions:
        entry.definitions.length > 0
          ? entry.definitions.map((definition) => ({
              part_of_speech: definition.part_of_speech,
              meaning: definition.meaning,
              example: definition.example,
              note: definition.note,
            }))
          : [emptyDefinition()],
    });
  }

  function updateDefinition(index: number, patch: Partial<DefinitionDraft>) {
    setEditor((current) => {
      if (!current) return current;
      const definitions = current.definitions.map((definition, i) =>
        i === index ? { ...definition, ...patch } : definition,
      );
      return { ...current, definitions };
    });
  }

  function addDefinition() {
    setEditor((current) =>
      current ? { ...current, definitions: [...current.definitions, emptyDefinition()] } : current,
    );
  }

  function removeDefinition(index: number) {
    setEditor((current) => {
      if (!current) return current;
      const definitions = current.definitions.filter((_, i) => i !== index);
      return { ...current, definitions: definitions.length > 0 ? definitions : [emptyDefinition()] };
    });
  }

  async function callGenerate(body: Record<string, unknown>) {
    const response = await fetch("/api/ai/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await response.json()) as Record<string, unknown>;
  }

  async function aiFill() {
    if (!editor?.word.trim()) {
      setMessage({ tone: "error", text: "请先填写单词" });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const data = await callGenerate({ action: "fill", word: editor.word.trim() });
      if (typeof data.error === "string") {
        setMessage({ tone: "error", text: data.error });
        return;
      }
      const definitions = data.definitions as DefinitionDraft[] | undefined;
      if (!definitions?.length) {
        setMessage({ tone: "error", text: "AI 未返回有效内容" });
        return;
      }
      setEditor((current) => (current ? { ...current, definitions } : current));
      setMessage({ tone: "ok", text: "已填充 AI 生成的内容，确认后保存" });
    } catch {
      setMessage({ tone: "error", text: "调用 AI 失败，请检查设置中的模型配置" });
    } finally {
      setBusy(false);
    }
  }

  async function aiField(index: number, action: "example" | "note") {
    const definition = editor?.definitions[index];
    if (!editor || !definition) return;
    if (!definition.meaning.trim()) {
      setMessage({ tone: "error", text: "请先填写释义" });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const data = await callGenerate({
        action,
        word: editor.word.trim(),
        partOfSpeech: definition.part_of_speech,
        meaning: definition.meaning.trim(),
      });
      if (typeof data.error === "string") {
        setMessage({ tone: "error", text: data.error });
        return;
      }
      if (action === "example" && typeof data.example === "string") {
        updateDefinition(index, { example: data.example });
      }
      if (action === "note" && typeof data.note === "string") {
        updateDefinition(index, { note: data.note });
      }
    } catch {
      setMessage({ tone: "error", text: "调用 AI 失败" });
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (!editor) return;
    setBusy(true);
    setMessage(null);
    startTransition(async () => {
      const result = await saveWordAction({
        listId,
        wordId: editor.id,
        word: editor.word,
        definitions: editor.definitions,
      });
      setBusy(false);
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error ?? "保存失败" });
        return;
      }
      setEditor(null);
      setMessage({ tone: "ok", text: "已保存" });
      router.refresh();
    });
  }

  function remove(entry: WordEntry) {
    if (!window.confirm(`确定删除「${entry.word}」吗？该操作不可撤销。`)) return;
    startTransition(async () => {
      const result = await deleteWordAction(entry.id);
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error ?? "删除失败" });
        return;
      }
      router.refresh();
    });
  }

  function toggleMark(entry: WordEntry) {
    startTransition(async () => {
      const result = await toggleMarkAction(entry.id, !entry.marked);
      if (!result.ok) setMessage({ tone: "error", text: result.error ?? "操作失败" });
      else router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <input
          className="field max-w-xs flex-1"
          placeholder="搜索单词或释义…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            className="size-4 rounded border-slate-300 text-indigo-600"
            checked={markedOnly}
            onChange={(event) => setMarkedOnly(event.target.checked)}
          />
          只看标注
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            className="size-4 rounded border-slate-300 text-indigo-600"
            checked={alphabetical}
            onChange={(event) => setAlphabetical(event.target.checked)}
          />
          按字母排序
        </label>

        <div className="ml-auto flex items-center gap-2">
          <a
            className="btn-secondary"
            href={`/api/export?marked_only=${markedOnly}&sort=${alphabetical}`}
            download
          >
            导出 CSV
          </a>
          <button type="button" className="btn-primary" onClick={openCreate}>
            + 添加单词
          </button>
        </div>
      </div>

      {message ? (
        <p
          className={`rounded-lg px-3 py-2 text-sm ${
            message.tone === "ok"
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
          }`}
        >
          {message.text}
        </p>
      ) : null}

      {editor ? (
        <div className="card space-y-5 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{editor.id ? "编辑单词" : "添加单词"}</h2>
            <button type="button" className="btn-secondary" onClick={() => void aiFill()} disabled={busy}>
              ✨ AI 一键填充
            </button>
          </div>

          <div>
            <label className="label">单词</label>
            <input
              className="field max-w-sm"
              value={editor.word}
              onChange={(event) =>
                setEditor((current) => (current ? { ...current, word: event.target.value } : current))
              }
              placeholder="例如 achieve"
            />
          </div>

          <div className="space-y-4">
            {editor.definitions.map((definition, index) => (
              <div
                key={index}
                className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800"
              >
                <div className="flex items-center gap-3">
                  <select
                    className="field w-40"
                    value={definition.part_of_speech}
                    onChange={(event) => updateDefinition(index, { part_of_speech: event.target.value })}
                  >
                    {PARTS_OF_SPEECH.map((pos) => (
                      <option key={pos.value} value={pos.value}>
                        {pos.label}
                      </option>
                    ))}
                  </select>
                  <span className="text-sm text-slate-400">释义 {index + 1}</span>
                  <button
                    type="button"
                    className="btn-secondary ml-auto px-2 py-1 text-xs"
                    onClick={() => removeDefinition(index)}
                  >
                    删除
                  </button>
                </div>

                <textarea
                  className="field min-h-20"
                  placeholder="释义，多个释义用「；」分隔"
                  value={definition.meaning}
                  onChange={(event) => updateDefinition(index, { meaning: event.target.value })}
                />

                <div className="flex items-center justify-between">
                  <label className="label mb-0">例句</label>
                  <button
                    type="button"
                    className="btn-secondary px-2 py-1 text-xs"
                    onClick={() => void aiField(index, "example")}
                    disabled={busy}
                  >
                    ✨ 生成例句
                  </button>
                </div>
                <textarea
                  className="field min-h-16"
                  placeholder="英文例句 + 中文翻译"
                  value={definition.example}
                  onChange={(event) => updateDefinition(index, { example: event.target.value })}
                />

                <div className="flex items-center justify-between">
                  <label className="label mb-0">学习笔记</label>
                  <button
                    type="button"
                    className="btn-secondary px-2 py-1 text-xs"
                    onClick={() => void aiField(index, "note")}
                    disabled={busy}
                  >
                    ✨ 生成笔记
                  </button>
                </div>
                <input
                  className="field"
                  placeholder="记忆技巧、常用搭配…"
                  value={definition.note}
                  onChange={(event) => updateDefinition(index, { note: event.target.value })}
                />
              </div>
            ))}
          </div>

          <button type="button" className="btn-secondary" onClick={addDefinition}>
            + 添加词性/释义
          </button>

          <div className="flex justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
            <button type="button" className="btn-secondary" onClick={() => setEditor(null)}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={save} disabled={busy || pending}>
              {busy || pending ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="card overflow-hidden">
        {visible.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">
            {initialWords.length === 0 ? "还没有单词，点击「添加单词」开始吧" : "没有匹配的结果"}
          </p>
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {visible.map((entry) => {
              const expanded = expandedId === entry.id;
              return (
                <li
                  key={entry.id}
                  className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                >
                  <div className="flex flex-wrap items-start gap-4">
                    <button
                      type="button"
                      className="mt-0.5 text-xl leading-none"
                      title={entry.marked ? "取消标注" : "标注为重点"}
                      onClick={() => toggleMark(entry)}
                    >
                      {entry.marked ? "⭐" : "☆"}
                    </button>

                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => setExpandedId(expanded ? null : entry.id)}
                        aria-expanded={expanded}
                        title={expanded ? "收起详情" : "点击查看例句与笔记"}
                        className="group flex items-center gap-1.5 text-left"
                      >
                        <span className="text-base font-medium group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                          {entry.word}
                        </span>
                        <span
                          aria-hidden
                          className={`text-[0.65rem] text-slate-400 transition-transform ${
                            expanded ? "rotate-90" : ""
                          }`}
                        >
                          ▶
                        </span>
                      </button>

                      <div className="mt-1 space-y-1">
                        {entry.definitions.length === 0 ? (
                          <p className="text-sm text-slate-400">暂无释义</p>
                        ) : (
                          entry.definitions.map((definition) => (
                            <p key={definition.id} className="text-sm text-slate-600 dark:text-slate-300">
                              <span className="mr-1.5 text-xs text-indigo-600 dark:text-indigo-400">
                                {definition.part_of_speech}
                              </span>
                              {definition.meaning}
                            </p>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn-secondary px-2.5 py-1 text-xs"
                        onClick={() => openEdit(entry)}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className="btn-danger px-2.5 py-1 text-xs"
                        onClick={() => remove(entry)}
                      >
                        删除
                      </button>
                    </div>
                  </div>

                  {expanded ? (
                    <div className="mt-3 space-y-4 border-l-2 border-indigo-200 pl-4 dark:border-indigo-900">
                      {entry.definitions.length === 0 ? (
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          这个单词还没有内容，点「编辑」补充释义、例句或笔记。
                        </p>
                      ) : (
                        entry.definitions.map((definition) => (
                          <div key={definition.id} className="space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="chip bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                                {definition.part_of_speech}
                              </span>
                              <span className="text-sm font-medium">{definition.meaning}</span>
                            </div>
                            {definition.example ? (
                              <p className="whitespace-pre-line text-sm text-slate-600 dark:text-slate-300">
                                {definition.example}
                              </p>
                            ) : null}
                            {definition.note ? (
                              <p className="text-sm text-slate-500 dark:text-slate-400">
                                💡 {definition.note}
                              </p>
                            ) : null}
                            {!definition.example && !definition.note ? (
                              <p className="text-xs text-slate-400">暂无例句与笔记</p>
                            ) : null}
                          </div>
                        ))
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

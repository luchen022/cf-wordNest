"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveAiSettingsAction, testAiConnectionAction } from "@/app/actions/settings";
import { createListAction, deleteListAction, renameListAction, switchListAction } from "@/app/actions/lists";

interface ListSummary {
  id: number;
  name: string;
  word_count: number;
}

interface AiSettings {
  baseUrl: string;
  model: string;
  apiKeyMasked: string;
  hasApiKey: boolean;
}

export function SettingsPanel({
  initial,
  lists,
  currentListId,
  profile,
}: {
  initial: AiSettings;
  lists: ListSummary[];
  currentListId: number;
  profile: { username: string; role: "admin" | "user"; createdAt: string };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [model, setModel] = useState(initial.model);
  const [apiKey, setApiKey] = useState(initial.apiKeyMasked);
  const [aiMessage, setAiMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const [newListName, setNewListName] = useState("");
  const [listMessage, setListMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function saveAi() {
    setAiBusy(true);
    setAiMessage(null);
    const result = await saveAiSettingsAction({ baseUrl, model, apiKey });
    setAiBusy(false);
    setAiMessage(
      result.ok
        ? { tone: "ok", text: result.message ?? "已保存" }
        : { tone: "error", text: result.error ?? "保存失败" },
    );
    if (result.ok) router.refresh();
  }

  async function testAi() {
    setAiBusy(true);
    setAiMessage(null);
    const result = await testAiConnectionAction({ baseUrl, model, apiKey });
    setAiBusy(false);
    setAiMessage(
      result.ok
        ? { tone: "ok", text: result.message ?? "连接成功" }
        : { tone: "error", text: result.error ?? "连接失败" },
    );
  }

  function createList() {
    setListMessage(null);
    startTransition(async () => {
      const result = await createListAction(newListName);
      if (!result.ok) {
        setListMessage({ tone: "error", text: result.error ?? "创建失败" });
        return;
      }
      setNewListName("");
      setListMessage({ tone: "ok", text: "已创建并切换" });
      router.refresh();
    });
  }

  function renameList(list: ListSummary) {
    const name = window.prompt("新的词表名称", list.name);
    if (name === null || name.trim() === "" || name === list.name) return;
    setListMessage(null);
    startTransition(async () => {
      const result = await renameListAction(list.id, name);
      setListMessage(
        result.ok ? { tone: "ok", text: "已重命名" } : { tone: "error", text: result.error ?? "重命名失败" },
      );
      if (result.ok) router.refresh();
    });
  }

  function deleteList(list: ListSummary) {
    if (!window.confirm(`确定删除词表「${list.name}」吗？`)) return;
    setListMessage(null);
    startTransition(async () => {
      const result = await deleteListAction(list.id);
      setListMessage(
        result.ok ? { tone: "ok", text: "已删除" } : { tone: "error", text: result.error ?? "删除失败" },
      );
      if (result.ok) router.refresh();
    });
  }

  function switchTo(list: ListSummary) {
    if (list.id === currentListId) return;
    startTransition(async () => {
      await switchListAction(list.id);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <h2 className="text-lg font-semibold">AI 模型配置</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          填入你自己的 OpenAI 兼容接口。密钥仅保存在你自己的账号下，界面只显示掩码。
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="base-url">
              Base URL
            </label>
            <input
              id="base-url"
              className="field"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.deepseek.com 或 https://api.openai.com/v1"
            />
            <p className="mt-1.5 text-xs text-slate-400">
              兼容 OpenAI 格式的服务：DeepSeek、OpenAI、OpenRouter、各类中转网关均可
            </p>
          </div>

          <div>
            <label className="label" htmlFor="model">
              模型 ID
            </label>
            <input
              id="model"
              className="field"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="deepseek-chat"
            />
          </div>

          <div>
            <label className="label" htmlFor="api-key">
              API Key
            </label>
            <input
              id="api-key"
              className="field"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="sk-…"
              autoComplete="off"
            />
            {initial.hasApiKey ? (
              <p className="mt-1.5 text-xs text-slate-400">保留掩码中的 * 即表示不修改已保存的密钥</p>
            ) : null}
          </div>
        </div>

        {aiMessage ? (
          <p
            className={`mt-4 rounded-lg px-3 py-2 text-sm ${
              aiMessage.tone === "ok"
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
            }`}
          >
            {aiMessage.text}
          </p>
        ) : null}

        <div className="mt-5 flex gap-2">
          <button type="button" className="btn-primary" onClick={() => void saveAi()} disabled={aiBusy}>
            {aiBusy ? "处理中…" : "保存配置"}
          </button>
          <button type="button" className="btn-secondary" onClick={() => void testAi()} disabled={aiBusy}>
            测试连接
          </button>
        </div>
      </section>

      <section className="card p-6">
        <h2 className="text-lg font-semibold">词表管理</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          每个词表是一组独立的单词，非空词表需要先清空才能删除
        </p>

        <ul className="mt-5 divide-y divide-slate-200 dark:divide-slate-800">
          {lists.map((list) => (
            <li key={list.id} className="flex flex-wrap items-center gap-3 py-3">
              <button
                type="button"
                onClick={() => switchTo(list)}
                className="text-left"
                title="切换到这个词表"
              >
                <span className="font-medium">{list.name}</span>
                <span className="ml-2 text-sm text-slate-400">{list.word_count} 个单词</span>
              </button>

              {list.id === currentListId ? (
                <span className="chip bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                  当前
                </span>
              ) : null}

              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  className="btn-secondary px-2.5 py-1 text-xs"
                  onClick={() => renameList(list)}
                  disabled={pending}
                >
                  重命名
                </button>
                <button
                  type="button"
                  className="btn-danger px-2.5 py-1 text-xs"
                  onClick={() => deleteList(list)}
                  disabled={pending}
                >
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <input
            className="field max-w-xs"
            placeholder="新词表名称"
            value={newListName}
            onChange={(event) => setNewListName(event.target.value)}
          />
          <button type="button" className="btn-primary" onClick={createList} disabled={pending}>
            新建词表
          </button>
        </div>

        {listMessage ? (
          <p
            className={`mt-4 rounded-lg px-3 py-2 text-sm ${
              listMessage.tone === "ok"
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
            }`}
          >
            {listMessage.text}
          </p>
        ) : null}
      </section>

      <section className="card p-6">
        <h2 className="text-lg font-semibold">账号信息</h2>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-slate-400">用户名</dt>
            <dd className="mt-0.5 font-medium">{profile.username}</dd>
          </div>
          <div>
            <dt className="text-slate-400">角色</dt>
            <dd className="mt-0.5 font-medium">{profile.role === "admin" ? "管理员" : "普通用户"}</dd>
          </div>
          <div>
            <dt className="text-slate-400">注册时间</dt>
            <dd className="mt-0.5 font-medium">{profile.createdAt} UTC</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

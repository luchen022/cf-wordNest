"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Conversation {
  id: number;
  title: string;
  updated_at: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function TutorChat({ initialConversations }: { initialConversations: Conversation[] }) {
  const router = useRouter();
  const [conversations, setConversations] = useState(initialConversations);
  const [activeId, setActiveId] = useState<number | null>(initialConversations[0]?.id ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async (id: number) => {
    setError("");
    try {
      const response = await fetch(`/api/conversations/${id}`, { cache: "no-store" });
      const data = (await response.json()) as { messages?: ChatMessage[]; error?: string };
      if (data.error) {
        setError(data.error);
        return;
      }
      setMessages(
        (data.messages ?? []).filter(
          (message) => message.role === "user" || message.role === "assistant",
        ),
      );
    } catch {
      setError("加载对话失败");
    }
  }, []);

  useEffect(() => {
    if (activeId) void loadMessages(activeId);
    else setMessages([]);
  }, [activeId, loadMessages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function refreshConversations() {
    const response = await fetch("/api/conversations", { cache: "no-store" });
    const data = (await response.json()) as { conversations?: Conversation[] };
    if (data.conversations) setConversations(data.conversations);
    router.refresh();
  }

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;

    setInput("");
    setError("");
    setMessages((current) => [...current, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setStreaming(true);

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: activeId, message: text }),
      });

      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `请求失败 (HTTP ${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let createdConversationId: number | null = null;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const line = frame.trim();
          if (!line.startsWith("data:")) continue;
          const payloadText = line.slice(5).trim();
          if (!payloadText || payloadText === "[DONE]") continue;

          let payload: { content?: string; error?: string; conversationId?: number; done?: boolean };
          try {
            payload = JSON.parse(payloadText);
          } catch {
            continue;
          }

          if (payload.conversationId && !activeId) {
            createdConversationId = payload.conversationId;
            setActiveId(payload.conversationId);
          }
          if (payload.error) setError(payload.error);
          if (payload.content) {
            setMessages((current) => {
              const next = [...current];
              const last = next[next.length - 1];
              if (last && last.role === "assistant") {
                next[next.length - 1] = { ...last, content: last.content + payload.content };
              }
              return next;
            });
          }
        }
      }

      if (createdConversationId) await refreshConversations();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "发送失败");
      setMessages((current) => current.filter((message) => message.role !== "assistant" || message.content));
    } finally {
      setStreaming(false);
      void refreshConversations();
    }
  }

  async function removeConversation(id: number) {
    if (!window.confirm("确定删除这个对话吗？")) return;
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (activeId === id) setActiveId(null);
    await refreshConversations();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <aside className="card flex h-fit flex-col p-3">
        <button
          type="button"
          className="btn-primary w-full"
          onClick={() => {
            setActiveId(null);
            setMessages([]);
            setError("");
          }}
        >
          + 新对话
        </button>

        <ul className="mt-3 max-h-[26rem] space-y-1 overflow-y-auto">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <div
                className={`group flex items-center gap-1 rounded-lg px-2.5 py-2 text-sm ${
                  activeId === conversation.id
                    ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                    : "hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left"
                  onClick={() => setActiveId(conversation.id)}
                  title={conversation.title}
                >
                  {conversation.title}
                </button>
                <button
                  type="button"
                  className="shrink-0 rounded px-1 text-xs text-slate-400 opacity-0 transition group-hover:opacity-100 hover:text-red-500"
                  onClick={() => void removeConversation(conversation.id)}
                  title="删除对话"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
          {conversations.length === 0 ? (
            <li className="px-3 py-6 text-center text-xs text-slate-400">还没有历史对话</li>
          ) : null}
        </ul>
      </aside>

      <section className="card flex h-[32rem] flex-col">
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-5">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="text-4xl">🤖</div>
              <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                试试问：「从我的词表里抽 5 个词考考我」
              </p>
            </div>
          ) : (
            messages.map((message, index) => (
              <div
                key={index}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${
                    message.role === "user"
                      ? "bg-indigo-600 text-white"
                      : "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100"
                  }`}
                >
                  {message.content || (streaming ? "▍" : "")}
                </div>
              </div>
            ))
          )}
        </div>

        {error ? (
          <p className="mx-5 mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        ) : null}

        <div className="flex items-end gap-2 border-t border-slate-200 p-4 dark:border-slate-800">
          <textarea
            className="field max-h-32 min-h-11 flex-1 resize-none"
            placeholder="问点什么…（Enter 发送，Shift+Enter 换行）"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            disabled={streaming}
          />
          <button type="button" className="btn-primary" onClick={() => void send()} disabled={streaming || !input.trim()}>
            {streaming ? "生成中…" : "发送"}
          </button>
        </div>
      </section>
    </div>
  );
}

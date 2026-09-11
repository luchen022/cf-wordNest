import { after, type NextRequest } from "next/server";
import { chatCompletionStream, getAiConfig, type ChatMessage } from "@/lib/ai";
import { getCurrentUser } from "@/lib/auth";
import { getDb, type MessageRow, type UserRow } from "@/lib/db";
import { ensureUserBootstrap } from "@/lib/lists";
import { asId, asString } from "@/lib/validate";

const HISTORY_LIMIT = 20;
const VOCAB_LIMIT = 150;

// Builds the tutor system prompt. Rather than asking the model to write SQL
// against the user's vocabulary (as the Flask version did), a compact digest of
// the current list is injected directly. For a personal vocabulary list this is
// cheaper and faster, and it removes the generated-SQL injection surface.
async function buildSystemPrompt(user: UserRow): Promise<string> {
  const list = await ensureUserBootstrap(user);
  const db = await getDb();

  const stats = await db
    .prepare("SELECT COUNT(*) AS total, COALESCE(SUM(marked), 0) AS marked FROM words WHERE list_id = ?")
    .bind(list.id)
    .first<{ total: number; marked: number }>();

  const { results: words } = await db
    .prepare(
      `SELECT w.word, w.marked, GROUP_CONCAT(d.meaning, '；') AS meanings
       FROM words w
       LEFT JOIN definitions d ON d.word_id = w.id
       WHERE w.list_id = ?
       GROUP BY w.id
       ORDER BY w.word COLLATE NOCASE ASC
       LIMIT ?`,
    )
    .bind(list.id, VOCAB_LIMIT)
    .all<{ word: string; marked: number; meanings: string | null }>();

  const digest = words
    .map((row) => `- ${row.word}${row.marked ? " [已标注]" : ""}：${(row.meanings ?? "").slice(0, 120) || "（暂无释义）"}`)
    .join("\n");

  const truncated = (stats?.total ?? 0) > words.length;

  return `你是 WordNest 的英语学习助教，服务对象是一位中文母语的英语学习者。
回答请使用中文，简洁、友好、可操作。

学习者当前词表：「${list.name}」
单词总数：${stats?.total ?? 0}，其中已标注：${stats?.marked ?? 0}

词表内容${truncated ? `（仅显示前 ${words.length} 个）` : ""}：
${digest || "（词表为空）"}

当用户要求抽查、测试或询问词表中的单词时，请基于上面的词表内容回答，不要编造词表中不存在的单词。
当用户询问单词用法、语法、记忆方法等通用知识时，正常作答即可。
如果用户在对话中提供了新单词，可以给出释义，但不要声称它已经加入词表。`;
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });

  const config = await getAiConfig(user.id);
  if (!config) {
    return Response.json(
      { error: "请先在设置中配置你自己的模型接口（Base URL / 模型 / API Key）" },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const message = asString(body.message, 4000);
  if (!message) return Response.json({ error: "消息不能为空" }, { status: 400 });

  const db = await getDb();
  let conversationId = asId(body.conversationId);

  if (conversationId) {
    const existing = await db
      .prepare("SELECT id FROM conversations WHERE id = ? AND user_id = ?")
      .bind(conversationId, user.id)
      .first<{ id: number }>();
    if (!existing) return Response.json({ error: "对话不存在" }, { status: 404 });
  } else {
    const inserted = await db
      .prepare("INSERT INTO conversations (user_id, title) VALUES (?, ?)")
      .bind(user.id, message.slice(0, 30) || "新对话")
      .run();
    conversationId = Number(inserted.meta.last_row_id);
  }

  const activeConversationId = conversationId;

  await db
    .prepare("INSERT INTO messages (conversation_id, role, content) VALUES (?, 'user', ?)")
    .bind(activeConversationId, message)
    .run();

  const { results: history } = await db
    .prepare("SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?")
    .bind(activeConversationId, HISTORY_LIMIT)
    .all<Pick<MessageRow, "role" | "content">>();

  const messages: ChatMessage[] = [
    { role: "system", content: await buildSystemPrompt(user) },
    ...history.reverse().map((row) => ({ role: row.role, content: row.content })),
  ];

  let upstream: Response;
  try {
    upstream = await chatCompletionStream(config, messages);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "调用模型失败";
    console.error(JSON.stringify({ message: "tutor stream failed", error: detail }));
    return Response.json({ error: detail }, { status: 502 });
  }

  const upstreamBody = upstream.body;
  if (!upstreamBody) return Response.json({ error: "模型未返回流式响应" }, { status: 502 });

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let assistantText = "";
  let buffer = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstreamBody.getReader();
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      send({ conversationId: activeConversationId });

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;

            try {
              const parsed = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
              const delta = parsed.choices?.[0]?.delta?.content;
              if (typeof delta === "string" && delta) {
                assistantText += delta;
                send({ content: delta });
              }
            } catch {
              // Providers may emit keep-alive or non-JSON frames; skip them.
            }
          }
        }
      } catch (error) {
        send({ error: error instanceof Error ? error.message : "流式响应中断" });
      } finally {
        send({ done: true });
        controller.close();
        reader.releaseLock();
      }
    },
  });

  // Persist after the response completes. `after()` is tied to the Workers
  // request lifetime, so this write is not dropped when the handler returns.
  after(async () => {
    if (!assistantText.trim()) return;
    const database = await getDb();
    await database
      .prepare("INSERT INTO messages (conversation_id, role, content) VALUES (?, 'assistant', ?)")
      .bind(activeConversationId, assistantText)
      .run();
    await database
      .prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?")
      .bind(activeConversationId)
      .run();
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

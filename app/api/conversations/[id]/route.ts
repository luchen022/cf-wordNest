import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDb, type ConversationRow, type MessageRow } from "@/lib/db";
import { asId, asString } from "@/lib/validate";

async function owned(userId: number, id: number): Promise<ConversationRow | null> {
  return await (await getDb())
    .prepare("SELECT * FROM conversations WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<ConversationRow>();
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });

  const { id: rawId } = await context.params;
  const id = asId(rawId);
  if (!id) return Response.json({ error: "参数不合法" }, { status: 400 });

  const conversation = await owned(user.id, id);
  if (!conversation) return Response.json({ error: "对话不存在" }, { status: 404 });

  const { results: messages } = await (await getDb())
    .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC")
    .bind(id)
    .all<MessageRow>();

  return Response.json({ conversation, messages });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });

  const { id: rawId } = await context.params;
  const id = asId(rawId);
  if (!id || !(await owned(user.id, id))) return Response.json({ error: "对话不存在" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const title = asString(body.title, 80);
  if (!title) return Response.json({ error: "标题不能为空" }, { status: 400 });

  await (await getDb())
    .prepare("UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(title, id)
    .run();

  return Response.json({ ok: true });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });

  const { id: rawId } = await context.params;
  const id = asId(rawId);
  if (!id || !(await owned(user.id, id))) return Response.json({ error: "对话不存在" }, { status: 404 });

  const db = await getDb();
  await db.batch([
    db.prepare("DELETE FROM messages WHERE conversation_id = ?").bind(id),
    db.prepare("DELETE FROM conversations WHERE id = ?").bind(id),
  ]);

  return Response.json({ ok: true });
}

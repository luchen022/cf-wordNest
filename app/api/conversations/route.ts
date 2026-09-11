import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDb, type ConversationRow } from "@/lib/db";
import { asString } from "@/lib/validate";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });

  const { results } = await (await getDb())
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
       FROM conversations c
       WHERE c.user_id = ?
       ORDER BY c.updated_at DESC, c.id DESC`,
    )
    .bind(user.id)
    .all<ConversationRow & { message_count: number }>();

  return Response.json({ conversations: results });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const title = asString(body.title, 80) || "新对话";

  const inserted = await (await getDb())
    .prepare("INSERT INTO conversations (user_id, title) VALUES (?, ?)")
    .bind(user.id, title)
    .run();

  return Response.json({ id: Number(inserted.meta.last_row_id), title });
}

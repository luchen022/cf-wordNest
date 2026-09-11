import { getCurrentUser } from "@/lib/auth";
import { getDb, type WordRow } from "@/lib/db";
import { asId } from "@/lib/validate";

/** Word detail used by the quiz reveal step. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });

  const { id: rawId } = await context.params;
  const id = asId(rawId);
  if (!id) return Response.json({ error: "参数不合法" }, { status: 400 });

  const db = await getDb();
  const word = await db
    .prepare(
      `SELECT w.* FROM words w
       JOIN lists l ON l.id = w.list_id
       WHERE w.id = ? AND l.user_id = ?`,
    )
    .bind(id, user.id)
    .first<WordRow>();
  if (!word) return Response.json({ error: "未找到该单词" }, { status: 404 });

  const { results: definitions } = await db
    .prepare(
      `SELECT id, part_of_speech, meaning, example, note
       FROM definitions WHERE word_id = ? ORDER BY sort_order ASC, id ASC`,
    )
    .bind(id)
    .all<{ id: number; part_of_speech: string; meaning: string; example: string; note: string }>();

  return Response.json({
    id: word.id,
    word: word.word,
    marked: word.marked === 1,
    definitions,
  });
}

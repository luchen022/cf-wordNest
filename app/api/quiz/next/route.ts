import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ensureUserBootstrap, getPrefs } from "@/lib/lists";

/**
 * Returns the next word to quiz on for the signed-in user's current list.
 * The definition is intentionally not included; the client fetches it on reveal.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });

  const list = await ensureUserBootstrap(user);
  const prefs = await getPrefs(user.id);
  const markedOnly = prefs?.marked_only === 1;
  const previous = request.nextUrl.searchParams.get("prev") ?? "";

  const filter = markedOnly ? "AND marked = 1" : "";
  const { results } = await (await getDb())
    .prepare(`SELECT id, word FROM words WHERE list_id = ? ${filter} ORDER BY RANDOM() LIMIT 5`)
    .bind(list.id)
    .all<{ id: number; word: string }>();

  if (results.length === 0) {
    const total = await (await getDb())
      .prepare("SELECT COUNT(*) AS total FROM words WHERE list_id = ?")
      .bind(list.id)
      .first<{ total: number }>();
    return Response.json({
      empty: true,
      reason: (total?.total ?? 0) === 0 ? "list_empty" : "no_marked",
      markedOnly,
    });
  }

  const picked = results.find((row) => row.word !== previous) ?? results[0];
  return Response.json({ wordId: picked.id, word: picked.word, markedOnly });
}

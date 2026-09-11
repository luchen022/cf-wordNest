import { getDb, type ListRow, type PrefsRow, type UserRow } from "./db";

export const DEFAULT_LIST_NAME = "默认词表";

/**
 * Makes sure a user always has at least one list and a prefs row, and returns
 * the list the user should currently be looking at.
 */
export async function ensureUserBootstrap(user: UserRow): Promise<ListRow> {
  const db = await getDb();

  let list = await db
    .prepare("SELECT * FROM lists WHERE user_id = ? ORDER BY id ASC LIMIT 1")
    .bind(user.id)
    .first<ListRow>();

  if (!list) {
    await db.prepare("INSERT INTO lists (user_id, name) VALUES (?, ?)").bind(user.id, DEFAULT_LIST_NAME).run();
    list = await db
      .prepare("SELECT * FROM lists WHERE user_id = ? ORDER BY id ASC LIMIT 1")
      .bind(user.id)
      .first<ListRow>();
  }

  if (!list) throw new Error("无法初始化词表");

  const prefs = await db
    .prepare("SELECT * FROM user_prefs WHERE user_id = ?")
    .bind(user.id)
    .first<PrefsRow>();

  if (!prefs) {
    await db
      .prepare("INSERT INTO user_prefs (user_id, current_list_id, marked_only) VALUES (?, ?, 0)")
      .bind(user.id, list.id)
      .run();
  } else if (prefs.current_list_id !== list.id) {
    // The stored list may have been deleted; verify it still exists and belongs to the user.
    const current = prefs.current_list_id
      ? await db
          .prepare("SELECT * FROM lists WHERE id = ? AND user_id = ?")
          .bind(prefs.current_list_id, user.id)
          .first<ListRow>()
      : null;
    if (current) return current;
    await db
      .prepare("UPDATE user_prefs SET current_list_id = ?, updated_at = datetime('now') WHERE user_id = ?")
      .bind(list.id, user.id)
      .run();
  } else {
    return list;
  }

  return list;
}

export async function getPrefs(userId: number): Promise<PrefsRow | null> {
  return await (await getDb()).prepare("SELECT * FROM user_prefs WHERE user_id = ?").bind(userId).first<PrefsRow>();
}

export interface ListSummary extends ListRow {
  word_count: number;
}

export async function getListsWithCounts(userId: number): Promise<ListSummary[]> {
  const { results } = await (await getDb())
    .prepare(
      `SELECT l.*, COALESCE(COUNT(w.id), 0) AS word_count
       FROM lists l
       LEFT JOIN words w ON w.list_id = l.id
       WHERE l.user_id = ?
       GROUP BY l.id
       ORDER BY l.id ASC`,
    )
    .bind(userId)
    .all<ListSummary>();
  return results;
}

/** Resolves a list by id, verifying it belongs to the user. */
export async function getOwnedList(userId: number, listId: number): Promise<ListRow | null> {
  return await (await getDb())
    .prepare("SELECT * FROM lists WHERE id = ? AND user_id = ?")
    .bind(listId, userId)
    .first<ListRow>();
}

"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { getDb, type ListRow, type PrefsRow } from "@/lib/db";
import { DEFAULT_LIST_NAME, getOwnedList } from "@/lib/lists";
import { asId, asString } from "@/lib/validate";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

async function currentUserOrError() {
  const user = await getCurrentUser();
  if (!user) return { user: null, error: "未登录" as string };
  return { user, error: null };
}

function revalidateAll() {
  revalidatePath("/");
  revalidatePath("/words");
  revalidatePath("/settings");
}

export async function createListAction(name: string): Promise<ActionResult> {
  const { user, error } = await currentUserOrError();
  if (!user) return { ok: false, error };

  const clean = asString(name, 60);
  if (!clean) return { ok: false, error: "词表名称不能为空" };

  const db = await getDb();
  const existing = await db
    .prepare("SELECT id FROM lists WHERE user_id = ? AND name = ?")
    .bind(user.id, clean)
    .first<{ id: number }>();
  if (existing) return { ok: false, error: "同名词表已存在" };

  const inserted = await db
    .prepare("INSERT INTO lists (user_id, name) VALUES (?, ?)")
    .bind(user.id, clean)
    .run();

  await db
    .prepare(
      `INSERT INTO user_prefs (user_id, current_list_id, marked_only) VALUES (?, ?, 0)
       ON CONFLICT(user_id) DO UPDATE SET current_list_id = excluded.current_list_id, updated_at = datetime('now')`,
    )
    .bind(user.id, Number(inserted.meta.last_row_id))
    .run();

  revalidateAll();
  return { ok: true };
}

export async function renameListAction(listId: number, name: string): Promise<ActionResult> {
  const { user, error } = await currentUserOrError();
  if (!user) return { ok: false, error };

  const id = asId(listId);
  const clean = asString(name, 60);
  if (!id || !clean) return { ok: false, error: "参数不合法" };
  if (!(await getOwnedList(user.id, id))) return { ok: false, error: "词表不存在" };

  const duplicate = await (await getDb())
    .prepare("SELECT id FROM lists WHERE user_id = ? AND name = ? AND id <> ?")
    .bind(user.id, clean, id)
    .first<{ id: number }>();
  if (duplicate) return { ok: false, error: "同名词表已存在" };

  await (await getDb()).prepare("UPDATE lists SET name = ? WHERE id = ?").bind(clean, id).run();
  revalidateAll();
  return { ok: true };
}

export async function deleteListAction(listId: number): Promise<ActionResult> {
  const { user, error } = await currentUserOrError();
  if (!user) return { ok: false, error };

  const id = asId(listId);
  if (!id) return { ok: false, error: "参数不合法" };

  const db = await getDb();
  const list = await getOwnedList(user.id, id);
  if (!list) return { ok: false, error: "词表不存在" };

  const total = await db
    .prepare("SELECT COUNT(*) AS total FROM lists WHERE user_id = ?")
    .bind(user.id)
    .first<{ total: number }>();
  if ((total?.total ?? 0) <= 1) return { ok: false, error: "至少需要保留一个词表" };

  const wordCount = await db
    .prepare("SELECT COUNT(*) AS total FROM words WHERE list_id = ?")
    .bind(id)
    .first<{ total: number }>();
  if ((wordCount?.total ?? 0) > 0) {
    return { ok: false, error: `词表不为空（${wordCount?.total} 个单词），请先清空` };
  }

  await db.prepare("DELETE FROM words WHERE list_id = ?").bind(id).run();
  await db.prepare("DELETE FROM lists WHERE id = ?").bind(id).run();

  const fallback = await db
    .prepare("SELECT * FROM lists WHERE user_id = ? ORDER BY id ASC LIMIT 1")
    .bind(user.id)
    .first<ListRow>();

  if (fallback) {
    await db
      .prepare("UPDATE user_prefs SET current_list_id = ?, updated_at = datetime('now') WHERE user_id = ?")
      .bind(fallback.id, user.id)
      .run();
  }

  revalidateAll();
  return { ok: true };
}

export async function switchListAction(listId: number): Promise<ActionResult> {
  const { user, error } = await currentUserOrError();
  if (!user) return { ok: false, error };

  const id = asId(listId);
  if (!id || !(await getOwnedList(user.id, id))) return { ok: false, error: "词表不存在" };

  await (await getDb())
    .prepare(
      `INSERT INTO user_prefs (user_id, current_list_id, marked_only) VALUES (?, ?, 0)
       ON CONFLICT(user_id) DO UPDATE SET current_list_id = excluded.current_list_id, updated_at = datetime('now')`,
    )
    .bind(user.id, id)
    .run();

  revalidateAll();
  return { ok: true };
}

export async function setMarkedOnlyAction(markedOnly: boolean): Promise<ActionResult> {
  const { user, error } = await currentUserOrError();
  if (!user) return { ok: false, error };

  const db = await getDb();
  const prefs = await db
    .prepare("SELECT * FROM user_prefs WHERE user_id = ?")
    .bind(user.id)
    .first<PrefsRow>();

  if (!prefs) {
    const list = await db
      .prepare("SELECT * FROM lists WHERE user_id = ? ORDER BY id ASC LIMIT 1")
      .bind(user.id)
      .first<ListRow>();
    await db
      .prepare("INSERT INTO user_prefs (user_id, current_list_id, marked_only) VALUES (?, ?, ?)")
      .bind(user.id, list?.id ?? null, markedOnly ? 1 : 0)
      .run();
  } else {
    await db
      .prepare("UPDATE user_prefs SET marked_only = ?, updated_at = datetime('now') WHERE user_id = ?")
      .bind(markedOnly ? 1 : 0, user.id)
      .run();
  }

  revalidatePath("/");
  return { ok: true };
}

/** Used by the settings page to seed a first list when the user has none. */
export async function ensureDefaultListAction(): Promise<ActionResult> {
  const { user, error } = await currentUserOrError();
  if (!user) return { ok: false, error };

  const existing = await (await getDb())
    .prepare("SELECT id FROM lists WHERE user_id = ? LIMIT 1")
    .bind(user.id)
    .first<{ id: number }>();
  if (existing) return { ok: true };

  await (await getDb())
    .prepare("INSERT INTO lists (user_id, name) VALUES (?, ?)")
    .bind(user.id, DEFAULT_LIST_NAME)
    .run();
  revalidateAll();
  return { ok: true };
}

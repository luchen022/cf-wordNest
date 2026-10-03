"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { getDb, type WordRow } from "@/lib/db";
import { getOwnedList } from "@/lib/lists";
import { asId, asString, parseDefinitions } from "@/lib/validate";

export interface WordActionResult {
  ok: boolean;
  error?: string;
  wordId?: number;
}

/** Confirms the word exists inside a list owned by this user. */
async function ownedWord(userId: number, wordId: number): Promise<WordRow | null> {
  return await (await getDb())
    .prepare(
      `SELECT w.* FROM words w
       JOIN lists l ON l.id = w.list_id
       WHERE w.id = ? AND l.user_id = ?`,
    )
    .bind(wordId, userId)
    .first<WordRow>();
}

function revalidateWordViews() {
  revalidatePath("/");
  revalidatePath("/words");
}

export async function saveWordAction(input: {
  listId: number;
  wordId?: number | null;
  word: string;
  definitions: unknown;
}): Promise<WordActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "未登录" };

  const listId = asId(input.listId);
  if (!listId || !(await getOwnedList(user.id, listId))) return { ok: false, error: "词表不存在" };

  const text = asString(input.word, 100);
  if (!text) return { ok: false, error: "单词不能为空" };

  const definitions = parseDefinitions(input.definitions);
  if (definitions.length === 0) return { ok: false, error: "请至少填写一个词义" };

  const db = await getDb();
  const clash = await db
    .prepare("SELECT id FROM words WHERE list_id = ? AND word = ?")
    .bind(listId, text)
    .first<{ id: number }>();

  const existingId = asId(input.wordId);

  if (existingId) {
    const existing = await ownedWord(user.id, existingId);
    if (!existing) return { ok: false, error: "单词不存在" };
    if (clash && clash.id !== existingId) return { ok: false, error: "该单词已存在" };
  } else if (clash) {
    return { ok: false, error: "该单词已存在" };
  }

  // Resolve the new word ID inside SQL so the entire save is one transaction.
  const statements = existingId
    ? [
        db.prepare("UPDATE words SET word = ?, list_id = ? WHERE id = ?").bind(text, listId, existingId),
        db.prepare("DELETE FROM definitions WHERE word_id = ?").bind(existingId),
        db.prepare("DELETE FROM word_relations WHERE word_id = ?").bind(existingId),
      ]
    : [db.prepare("INSERT INTO words (list_id, word, marked) VALUES (?, ?, 0)").bind(listId, text)];
  for (const [index, definition] of definitions.entries()) {
    statements.push(db.prepare(
      `INSERT INTO definitions (word_id, part_of_speech, meaning, example, note, sort_order)
       SELECT id, ?, ?, ?, ?, ? FROM words WHERE list_id = ? AND word = ?`,
    ).bind(definition.part_of_speech, definition.meaning, definition.example, definition.note, index, listId, text));
  }
  statements.push(db.prepare("SELECT id FROM words WHERE list_id = ? AND word = ?").bind(listId, text));
  try {
    const results = await db.batch<{ id: number }>(statements);
    const wordId = results[results.length - 1].results[0].id;
    revalidateWordViews();
    return { ok: true, wordId };
  } catch (error) {
    console.error(JSON.stringify({ message: "word save failed", error: String(error) }));
    return { ok: false, error: "保存失败，请重试；该单词可能已存在" };
  }
}

export async function deleteWordAction(wordId: number): Promise<WordActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "未登录" };

  const id = asId(wordId);
  if (!id || !(await ownedWord(user.id, id))) return { ok: false, error: "单词不存在" };

  const db = await getDb();
  await db.batch([
    db.prepare("DELETE FROM definitions WHERE word_id = ?").bind(id),
    db.prepare("DELETE FROM word_relations WHERE word_id = ?").bind(id),
    db.prepare("DELETE FROM words WHERE id = ?").bind(id),
  ]);

  revalidateWordViews();
  return { ok: true };
}

export async function toggleMarkAction(wordId: number, marked: boolean): Promise<WordActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "未登录" };

  const id = asId(wordId);
  if (!id || !(await ownedWord(user.id, id))) return { ok: false, error: "单词不存在" };

  await (await getDb())
    .prepare("UPDATE words SET marked = ? WHERE id = ?")
    .bind(marked ? 1 : 0, id)
    .run();

  revalidateWordViews();
  return { ok: true };
}

export async function addDefinitionAction(wordId: number, definition: unknown): Promise<WordActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "未登录" };

  const id = asId(wordId);
  if (!id || !(await ownedWord(user.id, id))) return { ok: false, error: "单词不存在" };

  const [parsed] = parseDefinitions([definition]);
  if (!parsed) return { ok: false, error: "词性和释义为必填项" };

  const db = await getDb();
  const maxOrder = await db
    .prepare("SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM definitions WHERE word_id = ?")
    .bind(id)
    .first<{ max_order: number }>();

  await db
    .prepare(
      `INSERT INTO definitions (word_id, part_of_speech, meaning, example, note, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      parsed.part_of_speech,
      parsed.meaning,
      parsed.example,
      parsed.note,
      (maxOrder?.max_order ?? -1) + 1,
    )
    .run();

  revalidateWordViews();
  return { ok: true };
}

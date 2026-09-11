import { env } from "cloudflare:workers";
import { ensureSchema } from "./schema";

export type Role = "admin" | "user";
export type UserStatus = "active" | "disabled";

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: Role;
  status: UserStatus;
  created_at: string;
  updated_at: string;
}

export interface ListRow {
  id: number;
  user_id: number;
  name: string;
  created_at: string;
}

export interface WordRow {
  id: number;
  list_id: number;
  word: string;
  marked: number;
  created_at: string;
}

export interface DefinitionRow {
  id: number;
  word_id: number;
  part_of_speech: string;
  meaning: string;
  example: string;
  note: string;
  sort_order: number;
}

export interface PrefsRow {
  user_id: number;
  current_list_id: number | null;
  marked_only: number;
  updated_at: string;
}

export interface AiSettingsRow {
  user_id: number;
  base_url: string;
  model: string;
  api_key: string;
  updated_at: string;
}

export interface ConversationRow {
  id: number;
  user_id: number;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: number;
  conversation_id: number;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

export interface WordRelationRow {
  id: number;
  word_id: number;
  relation_type: string;
  target_word: string;
  created_at: string;
}

/**
 * Returns the D1 binding, creating the schema first if this database is new.
 * Every data access goes through here, which is what makes a freshly connected
 * deployment usable without a separate migration step.
 */
export async function getDb(): Promise<D1Database> {
  await ensureSchema();
  return env.DB;
}

/** A word together with its definitions, as used by the UI and the CSV export. */
export interface WordWithDefinitions {
  id: number;
  word: string;
  marked: boolean;
  definitions: Array<{
    id: number;
    part_of_speech: string;
    meaning: string;
    example: string;
    note: string;
  }>;
}

/**
 * Loads words for a list with their definitions in a single joined query.
 * N+1 queries are avoided because D1 bills per row read.
 */
export async function loadWords(
  listId: number,
  options: { markedOnly?: boolean; alphabetical?: boolean; search?: string } = {},
): Promise<WordWithDefinitions[]> {
  const clauses = ["w.list_id = ?"];
  const binds: unknown[] = [listId];

  if (options.markedOnly) clauses.push("w.marked = 1");
  if (options.search) {
    clauses.push("(LOWER(w.word) LIKE ? OR LOWER(d.meaning) LIKE ?)");
    const needle = `%${options.search.toLowerCase()}%`;
    binds.push(needle, needle);
  }

  const order = options.alphabetical ? "w.word COLLATE NOCASE ASC" : "w.id ASC";

  const sql = `
    SELECT
      w.id AS word_id, w.word, w.marked,
      d.id AS definition_id, d.part_of_speech, d.meaning, d.example, d.note
    FROM words w
    LEFT JOIN definitions d ON d.word_id = w.id
    WHERE ${clauses.join(" AND ")}
    ORDER BY ${order}, d.sort_order ASC, d.id ASC
  `;

  const { results } = await (await getDb())
    .prepare(sql)
    .bind(...binds)
    .all<{
      word_id: number;
      word: string;
      marked: number;
      definition_id: number | null;
      part_of_speech: string | null;
      meaning: string | null;
      example: string | null;
      note: string | null;
    }>();

  const byId = new Map<number, WordWithDefinitions>();

  for (const row of results) {
    let entry = byId.get(row.word_id);
    if (!entry) {
      entry = { id: row.word_id, word: row.word, marked: row.marked === 1, definitions: [] };
      byId.set(row.word_id, entry);
    }
    if (row.definition_id !== null) {
      entry.definitions.push({
        id: row.definition_id,
        part_of_speech: row.part_of_speech ?? "",
        meaning: row.meaning ?? "",
        example: row.example ?? "",
        note: row.note ?? "",
      });
    }
  }

  return [...byId.values()];
}

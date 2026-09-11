import type { NextRequest } from "next/server";
import { chatCompletion, extractJson, getAiConfig } from "@/lib/ai";
import { getCurrentUser } from "@/lib/auth";
import { getDb, type WordRow, type WordRelationRow } from "@/lib/db";
import { asId } from "@/lib/validate";

const RELATION_TYPES = ["synonym", "antonym", "related", "topic"] as const;
type RelationType = (typeof RELATION_TYPES)[number];

const RELATION_LABELS: Record<RelationType, string> = {
  synonym: "同义",
  antonym: "反义",
  related: "相关",
  topic: "主题",
};

const RELATION_COLORS: Record<RelationType, string> = {
  synonym: "#22c55e",
  antonym: "#ef4444",
  related: "#3b82f6",
  topic: "#a855f7",
};

/** Relations are cached for 30 days; `refresh=1` forces a regeneration. */
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface GraphPayload {
  nodes: Array<{ id: string; label: string; group: string; color: string; size: number; isRoot: boolean }>;
  edges: Array<{ from: string; to: string; label: string; color: string }>;
  relations: Record<RelationType, string[]>;
  cached: boolean;
}

function buildGraph(focus: string, relations: Record<RelationType, string[]>): GraphPayload {
  const nodes: GraphPayload["nodes"] = [
    { id: focus, label: focus, group: "root", color: "#f97316", size: 30, isRoot: true },
  ];
  const edges: GraphPayload["edges"] = [];
  const seen = new Set([focus]);

  for (const type of RELATION_TYPES) {
    for (const target of relations[type]) {
      if (!target || seen.has(target)) continue;
      seen.add(target);
      nodes.push({
        id: target,
        label: target,
        group: type,
        color: RELATION_COLORS[type],
        size: 20,
        isRoot: false,
      });
      edges.push({ from: focus, to: target, label: RELATION_LABELS[type], color: RELATION_COLORS[type] });
    }
  }

  return { nodes, edges, relations, cached: false };
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });

  const wordId = asId(request.nextUrl.searchParams.get("wordId"));
  if (!wordId) return Response.json({ error: "缺少 wordId" }, { status: 400 });

  const refresh = request.nextUrl.searchParams.get("refresh") === "1";

  const db = await getDb();
  const word = await db
    .prepare(
      `SELECT w.* FROM words w
       JOIN lists l ON l.id = w.list_id
       WHERE w.id = ? AND l.user_id = ?`,
    )
    .bind(wordId, user.id)
    .first<WordRow>();
  if (!word) return Response.json({ error: "单词不存在" }, { status: 404 });

  const { results: cachedRows } = await db
    .prepare("SELECT * FROM word_relations WHERE word_id = ? ORDER BY id ASC")
    .bind(wordId)
    .all<WordRelationRow>();

  const cacheAge = cachedRows.length
    ? Date.now() - new Date(`${cachedRows[0].created_at.replace(" ", "T")}Z`).getTime()
    : Number.POSITIVE_INFINITY;
  const cacheValid = cachedRows.length > 0 && Number.isFinite(cacheAge) && cacheAge < CACHE_MAX_AGE_MS;

  if (!refresh && cacheValid) {
    const relations: Record<RelationType, string[]> = { synonym: [], antonym: [], related: [], topic: [] };
    for (const row of cachedRows) {
      if ((RELATION_TYPES as readonly string[]).includes(row.relation_type)) {
        relations[row.relation_type as RelationType].push(row.target_word);
      }
    }
    return Response.json({ ...buildGraph(word.word, relations), cached: true });
  }

  const config = await getAiConfig(user.id);
  if (!config) {
    return Response.json({ error: "请先在设置中配置你自己的模型接口" }, { status: 400 });
  }

  try {
    const content = await chatCompletion(
      config,
      [
        {
          role: "system",
          content: "你是一名英语词汇专家，只返回合法 JSON，不要任何解释或 markdown 代码块。",
        },
        {
          role: "user",
          content: `为英文单词 "${word.word}" 生成词汇关系图谱。
只返回如下 JSON：
{"synonym":["同义词"],"antonym":["反义词"],"related":["相关词"],"topic":["主题词"]}
每种类型 3-5 个真实存在的英语单词，找不到可少于 3 个。`,
        },
      ],
      { temperature: 0.6, maxTokens: 800, json: true },
    );

    const parsed = extractJson<Partial<Record<RelationType, unknown>>>(content);
    const relations: Record<RelationType, string[]> = { synonym: [], antonym: [], related: [], topic: [] };

    for (const type of RELATION_TYPES) {
      const value = parsed[type];
      if (Array.isArray(value)) {
        relations[type] = value
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter((item) => item && item.toLowerCase() !== word.word.toLowerCase())
          .slice(0, 8);
      }
    }

    const statements = [db.prepare("DELETE FROM word_relations WHERE word_id = ?").bind(wordId)];
    for (const type of RELATION_TYPES) {
      for (const target of relations[type]) {
        statements.push(
          db
            .prepare("INSERT OR IGNORE INTO word_relations (word_id, relation_type, target_word) VALUES (?, ?, ?)")
            .bind(wordId, type, target),
        );
      }
    }
    await db.batch(statements);

    return Response.json(buildGraph(word.word, relations));
  } catch (error) {
    const message = error instanceof Error ? error.message : "生成图谱失败";
    console.error(JSON.stringify({ message: "graph generation failed", word: word.word, error: message }));

    // Fall back to whatever was cached before rather than showing an empty page.
    if (cachedRows.length > 0) {
      const relations: Record<RelationType, string[]> = { synonym: [], antonym: [], related: [], topic: [] };
      for (const row of cachedRows) {
        if ((RELATION_TYPES as readonly string[]).includes(row.relation_type)) {
          relations[row.relation_type as RelationType].push(row.target_word);
        }
      }
      return Response.json({ ...buildGraph(word.word, relations), cached: true });
    }

    return Response.json({ error: message }, { status: 502 });
  }
}

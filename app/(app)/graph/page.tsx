import { GraphView } from "@/components/GraphView";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ensureUserBootstrap } from "@/lib/lists";

export const dynamic = "force-dynamic";

export default async function GraphPage() {
  const user = await requireUser();
  const list = await ensureUserBootstrap(user);

  const { results: words } = await (await getDb())
    .prepare("SELECT id, word FROM words WHERE list_id = ? ORDER BY word COLLATE NOCASE ASC")
    .bind(list.id)
    .all<{ id: number; word: string }>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">知识图谱</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          由 AI 生成单词之间的同义、反义、相关与主题关系，结果会缓存 30 天
        </p>
      </div>

      <GraphView words={words} />
    </div>
  );
}

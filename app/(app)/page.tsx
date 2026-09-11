import { QuizPanel } from "@/components/QuizPanel";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ensureUserBootstrap, getPrefs } from "@/lib/lists";
import { randomEncouragement } from "@/lib/constants";

export const dynamic = "force-dynamic";

export default async function PracticePage() {
  const user = await requireUser();
  const list = await ensureUserBootstrap(user);
  const prefs = await getPrefs(user.id);

  const stats = await (await getDb())
    .prepare("SELECT COUNT(*) AS total, COALESCE(SUM(marked), 0) AS marked FROM words WHERE list_id = ?")
    .bind(list.id)
    .first<{ total: number; marked: number }>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">单词练习</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          当前词表 <span className="font-medium text-slate-700 dark:text-slate-200">{list.name}</span> · 共{" "}
          {stats?.total ?? 0} 个单词，已标注 {stats?.marked ?? 0} 个
        </p>
      </div>

      <QuizPanel
        encouragement={randomEncouragement()}
        initialMarkedOnly={prefs?.marked_only === 1}
        empty={((stats?.total ?? 0) === 0)}
      />
    </div>
  );
}

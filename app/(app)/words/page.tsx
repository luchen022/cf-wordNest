import { WordManager } from "@/components/WordManager";
import { requireUser } from "@/lib/auth";
import { loadWords } from "@/lib/db";
import { ensureUserBootstrap } from "@/lib/lists";

export const dynamic = "force-dynamic";

export default async function WordsPage() {
  const user = await requireUser();
  const list = await ensureUserBootstrap(user);
  const words = await loadWords(list.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">词表</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {list.name} · 共 {words.length} 个单词
        </p>
      </div>

      <WordManager listId={list.id} initialWords={words} />
    </div>
  );
}

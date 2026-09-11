import { TutorChat } from "@/components/TutorChat";
import { requireUser } from "@/lib/auth";
import { getDb, type ConversationRow } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function TutorPage() {
  const user = await requireUser();

  const { results: conversations } = await (await getDb())
    .prepare("SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 100")
    .bind(user.id)
    .all<ConversationRow>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI 助教</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          它会读取你当前词表的内容，可以抽查、讲解、出题或聊学习方法
        </p>
      </div>

      <TutorChat initialConversations={conversations} />
    </div>
  );
}

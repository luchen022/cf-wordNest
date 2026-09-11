import { AdminPanel, type AdminUserRow } from "@/components/AdminPanel";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const admin = await requireAdmin();

  // password_hash is deliberately not selected: it never needs to reach the client.
  const { results } = await (await getDb())
    .prepare(
      `SELECT
         u.id, u.username, u.role, u.status, u.created_at,
         (SELECT COUNT(*) FROM words w
            JOIN lists l ON l.id = w.list_id
           WHERE l.user_id = u.id) AS word_count,
         (SELECT COUNT(*) FROM conversations c WHERE c.user_id = u.id) AS conversation_count
       FROM users u
       ORDER BY u.id ASC`,
    )
    .all<AdminUserRow>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">用户管理</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          创建账号、调整角色与状态。系统会始终保留至少一个启用的管理员。
        </p>
      </div>

      <AdminPanel users={results} currentUserId={admin.id} />
    </div>
  );
}

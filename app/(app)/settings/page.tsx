import { SettingsPanel } from "@/components/SettingsPanel";
import { requireUser } from "@/lib/auth";
import { getDb, type AiSettingsRow } from "@/lib/db";
import { ensureUserBootstrap, getListsWithCounts } from "@/lib/lists";
import { maskApiKey } from "@/lib/ai";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  const currentList = await ensureUserBootstrap(user);
  const [lists, settings] = await Promise.all([
    getListsWithCounts(user.id),
    await (await getDb()).prepare("SELECT * FROM user_ai_settings WHERE user_id = ?").bind(user.id).first<AiSettingsRow>(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">设置</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          模型配置与词表管理都只影响你自己的账号
        </p>
      </div>

      <SettingsPanel
        initial={{
          baseUrl: settings?.base_url ?? "https://api.deepseek.com",
          model: settings?.model ?? "deepseek-chat",
          apiKeyMasked: maskApiKey(settings?.api_key ?? ""),
          hasApiKey: Boolean(settings?.api_key),
        }}
        lists={lists}
        currentListId={currentList.id}
        profile={{ username: user.username, role: user.role, createdAt: user.created_at }}
      />
    </div>
  );
}

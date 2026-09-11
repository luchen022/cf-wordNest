import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { authConfigured, countUsers, getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");

  // The first visitor creates the administrator account; everyone else is
  // invited from the admin console.
  const setupMode = (await countUsers()) === 0;
  const configured = authConfigured();

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-slate-50 to-white px-4 py-10 dark:from-slate-950 dark:via-slate-950 dark:to-indigo-950">
      <div className="w-full">
        {configured ? null : (
          <div className="mx-auto mb-4 max-w-md rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <p className="font-medium">还差一步配置</p>
            <p className="mt-1 leading-6">
              该 Worker 尚未设置 <code>SESSION_SECRET</code>。请在 Cloudflare 控制台进入
              Worker → Settings → Variables and Secrets，添加一个名为
              <code className="mx-1">SESSION_SECRET</code>的密钥（类型选 Secret），保存后刷新本页。
            </p>
          </div>
        )}
        <AuthForm setupMode={setupMode} />
      </div>
    </main>
  );
}

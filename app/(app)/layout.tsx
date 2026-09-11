import { NavBar } from "@/components/NavBar";
import { requireUser } from "@/lib/auth";
import { ensureUserBootstrap, getListsWithCounts, getPrefs } from "@/lib/lists";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const currentList = await ensureUserBootstrap(user);
  const [lists, prefs] = await Promise.all([getListsWithCounts(user.id), getPrefs(user.id)]);

  return (
    <div className="min-h-screen">
      <NavBar
        username={user.username}
        role={user.role}
        lists={lists}
        currentListId={currentList.id}
        markedOnly={prefs?.marked_only === 1}
      />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}

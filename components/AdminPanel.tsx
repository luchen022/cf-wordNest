"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createUserAction,
  deleteUserAction,
  resetUserPasswordAction,
  updateUserAction,
} from "@/app/actions/admin";

export interface AdminUserRow {
  id: number;
  username: string;
  role: "admin" | "user";
  status: "active" | "disabled";
  created_at: string;
  word_count: number;
  conversation_count: number;
}

export function AdminPanel({ users, currentUserId }: { users: AdminUserRow[]; currentUserId: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  function report(result: { ok: boolean; error?: string; message?: string }) {
    setMessage(
      result.ok
        ? { tone: "ok", text: result.message ?? "操作成功" }
        : { tone: "error", text: result.error ?? "操作失败" },
    );
    if (result.ok) router.refresh();
  }

  function create() {
    setMessage(null);
    startTransition(async () => {
      const result = await createUserAction({ username, password, role });
      if (result.ok) {
        setUsername("");
        setPassword("");
        setRole("user");
      }
      report(result);
    });
  }

  function changeRole(user: AdminUserRow, next: "admin" | "user") {
    startTransition(async () => report(await updateUserAction({ userId: user.id, role: next })));
  }

  function changeStatus(user: AdminUserRow, next: "active" | "disabled") {
    startTransition(async () => report(await updateUserAction({ userId: user.id, status: next })));
  }

  function resetPassword(user: AdminUserRow) {
    const next = window.prompt(`为「${user.username}」设置新密码（至少 8 位）`);
    if (next === null || next === "") return;
    startTransition(async () => report(await resetUserPasswordAction({ userId: user.id, password: next })));
  }

  function remove(user: AdminUserRow) {
    if (!window.confirm(`确定删除用户「${user.username}」及其全部词表数据吗？该操作不可撤销。`)) return;
    startTransition(async () => report(await deleteUserAction(user.id)));
  }

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <h2 className="text-lg font-semibold">新建用户</h2>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="label">用户名</label>
            <input
              className="field max-w-[12rem]"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="3-32 位字母数字"
            />
          </div>
          <div>
            <label className="label">初始密码</label>
            <input
              className="field max-w-[12rem]"
              type="text"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 8 位"
              autoComplete="off"
            />
          </div>
          <div>
            <label className="label">角色</label>
            <select
              className="field w-32"
              value={role}
              onChange={(event) => setRole(event.target.value as "admin" | "user")}
            >
              <option value="user">普通用户</option>
              <option value="admin">管理员</option>
            </select>
          </div>
          <button type="button" className="btn-primary" onClick={create} disabled={pending}>
            创建
          </button>
        </div>
      </section>

      {message ? (
        <p
          className={`rounded-lg px-3 py-2 text-sm ${
            message.tone === "ok"
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
          }`}
        >
          {message.text}
        </p>
      ) : null}

      <section className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">用户</th>
                <th className="px-4 py-3 font-medium">角色</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">数据</th>
                <th className="px-4 py-3 font-medium">注册时间</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="px-4 py-3 font-medium">
                    {user.username}
                    {user.id === currentUserId ? (
                      <span className="ml-2 text-xs text-slate-400">(你)</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      className="field w-28 py-1 text-xs"
                      value={user.role}
                      disabled={pending}
                      onChange={(event) => changeRole(user, event.target.value as "admin" | "user")}
                    >
                      <option value="user">普通用户</option>
                      <option value="admin">管理员</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      className="field w-24 py-1 text-xs"
                      value={user.status}
                      disabled={pending}
                      onChange={(event) => changeStatus(user, event.target.value as "active" | "disabled")}
                    >
                      <option value="active">启用</option>
                      <option value="disabled">禁用</option>
                    </select>
                  </td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                    {user.word_count} 词 / {user.conversation_count} 对话
                  </td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{user.created_at}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        className="btn-secondary px-2.5 py-1 text-xs"
                        onClick={() => resetPassword(user)}
                        disabled={pending}
                      >
                        重置密码
                      </button>
                      <button
                        type="button"
                        className="btn-danger px-2.5 py-1 text-xs"
                        onClick={() => remove(user)}
                        disabled={pending || user.id === currentUserId}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

"use client";

import { useActionState, useState } from "react";
import { loginAction, registerAction, type AuthState } from "@/app/actions/auth";

const initialState: AuthState = {};

export function AuthForm({ setupMode }: { setupMode: boolean }) {
  const [mode, setMode] = useState<"login" | "register">(setupMode ? "register" : "login");
  const action = mode === "login" ? loginAction : registerAction;
  const [state, formAction, isPending] = useActionState(action, initialState);

  return (
    <div className="w-full max-w-md">
      <div className="mb-8 text-center">
        <div className="mb-3 text-5xl">🪺</div>
        <h1 className="text-2xl font-semibold tracking-tight">WordNest</h1>
        <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
          你的专属英语单词手账
        </p>
      </div>

      <div className="card p-6">
        <h2 className="text-lg font-semibold">
          {mode === "login" ? "登录" : "创建管理员账号"}
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {mode === "login"
            ? "使用你的账号登录以继续"
            : "这是系统的第一个账号，将拥有管理员权限"}
        </p>

        <form action={formAction} className="mt-6 space-y-4">
          <div>
            <label className="label" htmlFor="username">
              用户名
            </label>
            <input
              id="username"
              name="username"
              className="field"
              autoComplete="username"
              placeholder="3-32 位字母、数字、下划线"
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="password">
              密码
            </label>
            <input
              id="password"
              name="password"
              type="password"
              className="field"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder="至少 8 个字符"
              required
            />
          </div>

          {mode === "register" ? (
            <div>
              <label className="label" htmlFor="confirm">
                确认密码
              </label>
              <input
                id="confirm"
                name="confirm"
                type="password"
                className="field"
                autoComplete="new-password"
                required
              />
            </div>
          ) : null}

          {state.error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {state.error}
            </p>
          ) : null}

          <button type="submit" className="btn-primary w-full" disabled={isPending}>
            {isPending ? "处理中…" : mode === "login" ? "登录" : "创建账号并进入"}
          </button>
        </form>

        {setupMode ? null : (
          <button
            type="button"
            className="mt-4 w-full text-center text-sm text-slate-500 hover:text-indigo-600 dark:text-slate-400"
            onClick={() => setMode(mode === "login" ? "register" : "login")}
          >
            {mode === "login" ? "还没有账号？" : "已有账号？返回登录"}
          </button>
        )}
      </div>

      <p className="mt-6 text-center text-xs text-slate-400">
        账号由管理员创建，你的词表与模型配置仅对你本人可见
      </p>
    </div>
  );
}

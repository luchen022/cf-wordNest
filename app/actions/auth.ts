"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  authConfigured,
  countUsers,
  endSession,
  hashPassword,
  startSession,
  verifyPassword,
} from "@/lib/auth";
import { getDb, type UserRow } from "@/lib/db";
import { ensureUserBootstrap } from "@/lib/lists";
import { asString, isValidUsername, passwordProblem } from "@/lib/validate";

export interface AuthState {
  error?: string;
}

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;

const MISSING_SECRET =
  "服务端还没有配置 SESSION_SECRET。请在 Cloudflare 控制台的 Worker → Settings → " +
  "Variables and Secrets 中添加一个名为 SESSION_SECRET 的密钥，然后重试。";

async function clientIp(): Promise<string> {
  const store = await headers();
  return store.get("cf-connecting-ip") ?? store.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/** Returns the number of seconds left on an active lockout, or 0 when not locked. */
async function lockoutRemaining(key: string): Promise<number> {
  const row = await (await getDb())
    .prepare("SELECT blocked_until FROM login_attempts WHERE key = ?")
    .bind(key)
    .first<{ blocked_until: number }>();
  if (!row || row.blocked_until <= Date.now()) return 0;
  return Math.ceil((row.blocked_until - Date.now()) / 1000);
}

async function recordFailure(key: string): Promise<void> {
  const now = Date.now();
  const db = await getDb();
  const row = await db
    .prepare("SELECT count, first_at FROM login_attempts WHERE key = ?")
    .bind(key)
    .first<{ count: number; first_at: number }>();

  if (!row || now - row.first_at > LOCKOUT_MS) {
    await db
      .prepare(
        `INSERT INTO login_attempts (key, count, first_at, blocked_until) VALUES (?, 1, ?, 0)
         ON CONFLICT(key) DO UPDATE SET count = 1, first_at = excluded.first_at, blocked_until = 0`,
      )
      .bind(key, now)
      .run();
    return;
  }

  const count = row.count + 1;
  const blockedUntil = count >= MAX_ATTEMPTS ? now + LOCKOUT_MS : 0;
  await db
    .prepare("UPDATE login_attempts SET count = ?, blocked_until = ? WHERE key = ?")
    .bind(count, blockedUntil, key)
    .run();
}

async function clearFailures(key: string): Promise<void> {
  await (await getDb()).prepare("DELETE FROM login_attempts WHERE key = ?").bind(key).run();
}

export async function registerAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  if (!authConfigured()) return { error: MISSING_SECRET };

  const username = asString(formData.get("username"), 32);
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!isValidUsername(username)) {
    return { error: "用户名需为 3-32 位字母、数字、下划线、点或短横线" };
  }
  const problem = passwordProblem(password);
  if (problem) return { error: problem };
  if (password !== confirm) return { error: "两次输入的密码不一致" };

  // Only the very first account can self-register; it becomes the administrator.
  // Everyone else is created from the admin console.
  if ((await countUsers()) > 0) {
    return { error: "系统已初始化，请让管理员在后台为你创建账号" };
  }

  const db = await getDb();
  const passwordHash = await hashPassword(password);
  const inserted = await db
    .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')")
    .bind(username, passwordHash)
    .run();

  const userId = Number(inserted.meta.last_row_id);
  const user = await db.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<UserRow>();
  if (user) await ensureUserBootstrap(user);

  await startSession(userId);
  redirect("/");
}

export async function loginAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  if (!authConfigured()) return { error: MISSING_SECRET };

  const username = asString(formData.get("username"), 32);
  const password = String(formData.get("password") ?? "");
  if (!username || !password) return { error: "请输入用户名和密码" };

  const key = `${username.toLowerCase()}|${await clientIp()}`;
  const locked = await lockoutRemaining(key);
  if (locked > 0) return { error: `尝试次数过多，请在 ${locked} 秒后重试` };

  const user = await (await getDb())
    .prepare("SELECT * FROM users WHERE username = ?")
    .bind(username)
    .first<UserRow>();

  const passwordOk = user ? await verifyPassword(user.password_hash, password) : false;
  if (!user || !passwordOk) {
    await recordFailure(key);
    return { error: "用户名或密码错误" };
  }
  if (user.status !== "active") return { error: "账号已被禁用，请联系管理员" };

  await clearFailures(key);
  await ensureUserBootstrap(user);
  await startSession(user.id);
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect("/login");
}

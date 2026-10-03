"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, hashPassword } from "@/lib/auth";
import { getDb, type Role, type UserRow, type UserStatus } from "@/lib/db";
import { asId, asString, isValidUsername, passwordProblem } from "@/lib/validate";

export interface AdminResult {
  ok: boolean;
  error?: string;
  message?: string;
}

async function requireAdminUser(): Promise<{ admin: UserRow | null; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { admin: null, error: "未登录" };
  if (user.role !== "admin") return { admin: null, error: "需要管理员权限" };
  return { admin: user };
}

export async function getUsersAction(): Promise<Array<Omit<UserRow, "password_hash">>> {
  const { admin } = await requireAdminUser();
  if (!admin) return [];
  const { results } = await (await getDb())
    .prepare("SELECT id, username, role, status, created_at, updated_at FROM users ORDER BY id ASC")
    .all<Omit<UserRow, "password_hash">>();
  return results;
}

export async function createUserAction(input: {
  username: string;
  password: string;
  role: Role;
}): Promise<AdminResult> {
  const { admin, error } = await requireAdminUser();
  if (!admin) return { ok: false, error };

  const username = asString(input.username, 32);
  const password = String(input.password ?? "");
  const role: Role = input.role === "admin" ? "admin" : "user";

  if (!isValidUsername(username)) {
    return { ok: false, error: "用户名需为 3-32 位字母、数字、下划线、点或短横线" };
  }
  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: problem };

  const db = await getDb();
  const existing = await db
    .prepare("SELECT id FROM users WHERE username = ?")
    .bind(username)
    .first<{ id: number }>();
  if (existing) return { ok: false, error: "用户名已存在" };

  const passwordHash = await hashPassword(password);
  await db
    .prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)")
    .bind(username, passwordHash, role)
    .run();

  revalidatePath("/admin");
  return { ok: true, message: `已创建用户 ${username}` };
}

async function countActiveAdmins(excludeUserId: number): Promise<number> {
  const row = await (await getDb())
    .prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND status = 'active' AND id <> ?")
    .bind(excludeUserId)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

export async function updateUserAction(input: {
  userId: number;
  role?: Role;
  status?: UserStatus;
}): Promise<AdminResult> {
  const { admin, error } = await requireAdminUser();
  if (!admin) return { ok: false, error };

  const id = asId(input.userId);
  if (!id) return { ok: false, error: "参数不合法" };

  const target = await (await getDb()).prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
  if (!target) return { ok: false, error: "用户不存在" };

  const nextRole: Role = input.role === "admin" || input.role === "user" ? input.role : target.role;
  const nextStatus: UserStatus =
    input.status === "active" || input.status === "disabled" ? input.status : target.status;

  const losesAdmin = target.role === "admin" && (nextRole !== "admin" || nextStatus !== "active");
  if (losesAdmin && (await countActiveAdmins(id)) === 0) {
    return { ok: false, error: "系统必须保留至少一个启用的管理员" };
  }

  await (await getDb())
    .prepare("UPDATE users SET role = ?, status = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(nextRole, nextStatus, id)
    .run();

  revalidatePath("/admin");
  return { ok: true, message: "已更新" };
}

export async function resetUserPasswordAction(input: {
  userId: number;
  password: string;
}): Promise<AdminResult> {
  const { admin, error } = await requireAdminUser();
  if (!admin) return { ok: false, error };

  const id = asId(input.userId);
  const password = String(input.password ?? "");
  if (!id) return { ok: false, error: "参数不合法" };

  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: problem };

  const target = await (await getDb()).prepare("SELECT id FROM users WHERE id = ?").bind(id).first<{ id: number }>();
  if (!target) return { ok: false, error: "用户不存在" };

  const passwordHash = await hashPassword(password);
  await (await getDb())
    .prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(passwordHash, id)
    .run();

  // Sessions are bound to the password hash and are now invalid.

  revalidatePath("/admin");
  return { ok: true, message: "密码已重置" };
}

export async function deleteUserAction(userId: number): Promise<AdminResult> {
  const { admin, error } = await requireAdminUser();
  if (!admin) return { ok: false, error };

  const id = asId(userId);
  if (!id) return { ok: false, error: "参数不合法" };
  if (id === admin.id) return { ok: false, error: "不能删除当前登录的账号" };

  const target = await (await getDb()).prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
  if (!target) return { ok: false, error: "用户不存在" };
  if (target.role === "admin" && (await countActiveAdmins(id)) === 0) {
    return { ok: false, error: "系统必须保留至少一个启用的管理员" };
  }

  const db = await getDb();
  const ownedLists = await db
    .prepare("SELECT id FROM lists WHERE user_id = ?")
    .bind(id)
    .all<{ id: number }>();

  const statements = ownedLists.results.flatMap((list) => [
    db
      .prepare(
        "DELETE FROM definitions WHERE word_id IN (SELECT id FROM words WHERE list_id = ?)",
      )
      .bind(list.id),
    db.prepare("DELETE FROM word_relations WHERE word_id IN (SELECT id FROM words WHERE list_id = ?)").bind(list.id),
    db.prepare("DELETE FROM words WHERE list_id = ?").bind(list.id),
  ]);

  statements.push(
    db.prepare("DELETE FROM lists WHERE user_id = ?").bind(id),
    db.prepare("DELETE FROM user_prefs WHERE user_id = ?").bind(id),
    db.prepare("DELETE FROM user_ai_settings WHERE user_id = ?").bind(id),
    db.prepare("DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE user_id = ?)").bind(id),
    db.prepare("DELETE FROM conversations WHERE user_id = ?").bind(id),
    db.prepare("DELETE FROM users WHERE id = ?").bind(id),
  );

  await db.batch(statements);

  revalidatePath("/admin");
  return { ok: true, message: `已删除用户 ${target.username}` };
}

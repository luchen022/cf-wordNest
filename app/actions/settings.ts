"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { encryptCredential } from "@/lib/credentials";
import { asString } from "@/lib/validate";
import { buildChatCompletionsUrl, chatCompletion, getAiConfig, type AiConfig } from "@/lib/ai";

export interface SettingsResult {
  ok: boolean;
  error?: string;
  message?: string;
}

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-chat";

/**
 * Saves the signed-in user's own provider credentials.
 * A submitted key containing '*' is treated as "unchanged" so the masked value
 * shown in the UI can be round-tripped without exposing the real key.
 */
export async function saveAiSettingsAction(input: {
  baseUrl: string;
  model: string;
  apiKey: string;
}): Promise<SettingsResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "未登录" };

  const baseUrl = asString(input.baseUrl, 300) || DEFAULT_BASE_URL;
  const model = asString(input.model, 120) || DEFAULT_MODEL;
  const submittedKey = asString(input.apiKey, 400);

  try {
    const existing = submittedKey.includes("*") ? await getAiConfig(user.id) : null;
    const apiKey = submittedKey.includes("*") ? (existing?.apiKey ?? "") : submittedKey;
    buildChatCompletionsUrl(baseUrl);

    await (await getDb())
      .prepare(
        `INSERT INTO user_ai_settings (user_id, base_url, model, api_key, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(user_id) DO UPDATE SET
           base_url = excluded.base_url,
           model = excluded.model,
           api_key = excluded.api_key,
           updated_at = datetime('now')`,
      )
      .bind(user.id, baseUrl, model, await encryptCredential(apiKey, user.id))
      .run();

    revalidatePath("/settings");
    return { ok: true, message: "AI 配置已保存" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "保存失败" };
  }
}

/** Sends a one-token request to confirm the credentials work before saving. */
export async function testAiConnectionAction(input: {
  baseUrl: string;
  model: string;
  apiKey: string;
}): Promise<SettingsResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "未登录" };

  const submittedKey = asString(input.apiKey, 400);
  try {
    const existing = submittedKey.includes("*") ? await getAiConfig(user.id) : null;
    const config: AiConfig = {
      baseUrl: asString(input.baseUrl, 300) || DEFAULT_BASE_URL,
      model: asString(input.model, 120) || DEFAULT_MODEL,
      apiKey: submittedKey.includes("*") ? (existing?.apiKey ?? "") : submittedKey,
    };

    await chatCompletion(
      config,
      [{ role: "user", content: 'Reply with the single word "OK".' }],
      { maxTokens: 5, temperature: 0 },
    );
    return { ok: true, message: "连接成功，模型响应正常" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "连接失败" };
  }
}

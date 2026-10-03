import { getDb, type AiSettingsRow } from "./db";
import { decryptCredential, encryptCredential, isEncryptedCredential } from "./credentials";

export interface AiConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Builds the OpenAI-compatible chat completions URL from a user supplied base URL.
 * A full URL ending in /chat/completions is used as-is so any proxy shape works.
 */
export function buildChatCompletionsUrl(baseUrl: string): string {
  const value = baseUrl.trim();
  if (!value) throw new Error("Base URL 未配置");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Base URL 必须是合法的 HTTPS 地址"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Base URL 必须使用 HTTPS，且不能包含账号、查询参数或片段");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (!url.pathname.endsWith("/chat/completions")) url.pathname += "/chat/completions";
  return url.toString();
}

export async function getAiConfig(userId: number): Promise<AiConfig | null> {
  const row = await (await getDb())
    .prepare("SELECT * FROM user_ai_settings WHERE user_id = ?")
    .bind(userId)
    .first<AiSettingsRow>();

  if (!row || !row.base_url || !row.model) return null;
  const apiKey = await decryptCredential(row.api_key, userId);
  if (row.api_key && !isEncryptedCredential(row.api_key)) {
    // Compare-and-set preserves credentials changed by a concurrent settings save.
    await (await getDb()).prepare("UPDATE user_ai_settings SET api_key = ? WHERE user_id = ? AND api_key = ?")
      .bind(await encryptCredential(apiKey, userId), userId, row.api_key).run();
  }
  return { baseUrl: row.base_url, model: row.model, apiKey };
}

function headers(config: AiConfig): HeadersInit {
  const result: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) result.Authorization = `Bearer ${config.apiKey}`;
  return result;
}

export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  signal?: AbortSignal;
}

/**
 * Non-streaming chat completion. Throws an Error whose message is safe to show
 * to the signed-in user (it never contains the API key).
 */
export async function chatCompletion(
  config: AiConfig,
  messages: ChatMessage[],
  options: CompletionOptions = {},
): Promise<string> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature: options.temperature ?? 0.7,
  };
  if (options.maxTokens) body.max_tokens = options.maxTokens;
  if (options.json) body.response_format = { type: "json_object" };

  const response = await fetch(buildChatCompletionsUrl(config.baseUrl), {
    method: "POST",
    headers: headers(config),
    body: JSON.stringify(body),
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(60_000)])
      : AbortSignal.timeout(60_000),
    redirect: "error",
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`模型接口返回 HTTP ${response.status}：${detail}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("模型返回内容为空");
  return content;
}

/** Starts a streaming chat completion and returns the raw upstream response. */
export async function chatCompletionStream(
  config: AiConfig,
  messages: ChatMessage[],
  options: { temperature?: number; signal?: AbortSignal } = {},
): Promise<Response> {
  const response = await fetch(buildChatCompletionsUrl(config.baseUrl), {
    method: "POST",
    headers: headers(config),
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: options.temperature ?? 0.3,
      stream: true,
    }),
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(180_000)])
      : AbortSignal.timeout(180_000),
    redirect: "error",
  });

  if (!response.ok || !response.body) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`模型接口返回 HTTP ${response.status}${detail ? `：${detail}` : ""}`);
  }

  return response;
}

/** Extracts the first JSON object from a model response that may include prose or code fences. */
export function extractJson<T>(content: string): T {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : content;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("模型未返回 JSON");
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}

export function maskApiKey(apiKey: string): string {
  if (!apiKey) return "";
  if (apiKey.length <= 8) return "******";
  return `${apiKey.slice(0, 3)}******${apiKey.slice(-4)}`;
}

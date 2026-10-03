import { env } from "cloudflare:workers";

const PREFIX = "enc:v1:";

async function encryptionKey(): Promise<CryptoKey> {
  if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET 未配置");
  const material = await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(`wordnest:ai-credentials:v1:${env.SESSION_SECRET}`),
  );
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export function isEncryptedCredential(value: string): boolean {
  return value.startsWith(PREFIX);
}

export async function encryptCredential(value: string, userId: number): Promise<string> {
  if (!value) return "";
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(String(userId)) },
    await encryptionKey(), new TextEncoder().encode(value),
  ));
  const bytes = new Uint8Array(iv.length + ciphertext.length);
  bytes.set(iv);
  bytes.set(ciphertext, iv.length);
  return PREFIX + btoa(String.fromCharCode(...bytes));
}

export async function decryptCredential(value: string, userId: number): Promise<string> {
  // Legacy plaintext is upgraded by getAiConfig() when first read.
  if (!isEncryptedCredential(value)) return value;
  try {
    const bytes = Uint8Array.from(atob(value.slice(PREFIX.length)), (char) => char.charCodeAt(0));
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: new TextEncoder().encode(String(userId)) },
      await encryptionKey(), bytes.slice(12),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error("无法解密 AI 密钥，请在设置中重新填写密钥");
  }
}

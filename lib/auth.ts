import { env } from "cloudflare:workers";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, type UserRow } from "./db";

const COOKIE_NAME = "wordnest_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PBKDF2_ITERATIONS = 150_000;
const KEY_BYTES = 32;

/** Backed-by-ArrayBuffer bytes, which is what the WebCrypto BufferSource types require. */
type Bytes = Uint8Array<ArrayBuffer>;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Bytes {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function b64url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(value: string): Bytes {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return fromBase64(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
}

/** Constant-time comparison so signature checks do not leak timing information. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function pbkdf2(password: string, salt: Bytes, iterations: number): Promise<Bytes> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 5 || parts[0] !== "pbkdf2" || parts[1] !== "sha256") return false;
  const iterations = Number(parts[2]);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;
  try {
    const salt = fromBase64(parts[3]);
    const expected = fromBase64(parts[4]);
    const actual = await pbkdf2(password, salt, iterations);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function sessionSecret(): string {
  const secret = env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is not configured. Add it as a secret in the Cloudflare dashboard " +
        "(Worker > Settings > Variables and Secrets), or in .dev.vars for local development.",
    );
  }
  return secret;
}

/**
 * Whether the Worker can sign sessions. A brand new deployment works as soon as
 * SESSION_SECRET is set, so the UI checks this and explains the fix instead of
 * failing with a 500 on every page.
 */
export function authConfigured(): boolean {
  return Boolean(env.SESSION_SECRET);
}

export async function createSessionToken(userId: number): Promise<string> {
  const issuedAt = Date.now();
  const payload = `${userId}.${issuedAt}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", await hmacKey(sessionSecret()), new TextEncoder().encode(payload)),
  );
  return `${payload}.${b64url(signature)}`;
}

export async function verifySessionToken(token: string): Promise<number | null> {
  if (!authConfigured()) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [idPart, issuedPart, signaturePart] = parts;
  const payload = `${idPart}.${issuedPart}`;

  let provided: Bytes;
  try {
    provided = fromB64url(signaturePart);
  } catch {
    return null;
  }

  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", await hmacKey(sessionSecret()), new TextEncoder().encode(payload)),
  );
  if (!timingSafeEqual(expected, provided)) return null;

  const issuedAt = Number(issuedPart);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > SESSION_TTL_MS) return null;

  const userId = Number(idPart);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

export async function getCurrentUser(): Promise<UserRow | null> {
  if (!authConfigured()) return null;

  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const userId = await verifySessionToken(token);
  if (userId === null) return null;

  const user = await (await getDb()).prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<UserRow>();
  if (!user || user.status !== "active") return null;
  return user;
}

/** Server-component guard: redirects to /login when there is no valid session. */
export async function requireUser(): Promise<UserRow> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Server-component guard for admin-only pages. */
export async function requireAdmin(): Promise<UserRow> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/");
  return user;
}

export async function startSession(userId: number): Promise<void> {
  const token = await createSessionToken(userId);
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: await isSecureRequest(),
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

/**
 * Decides whether to set the Secure cookie flag.
 *
 * The built Worker always runs with NODE_ENV=production, so that flag cannot be
 * used to tell local development apart from a deployment. Behind Cloudflare the
 * request carries `x-forwarded-proto`; locally the host is a loopback address.
 */
async function isSecureRequest(): Promise<boolean> {
  const store = await headers();
  const forwardedProto = store.get("x-forwarded-proto");
  if (forwardedProto) return forwardedProto.split(",")[0].trim() === "https";

  const host = (store.get("host") ?? "").toLowerCase();
  return !(host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("[::1]"));
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function countUsers(): Promise<number> {
  const row = await (await getDb()).prepare("SELECT COUNT(*) AS total FROM users").first<{ total: number }>();
  return row?.total ?? 0;
}

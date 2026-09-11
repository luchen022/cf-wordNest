export function asString(value: unknown, maxLength = 2000): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

export function asId(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function isValidUsername(username: string): boolean {
  return /^[A-Za-z0-9_.-]{3,32}$/.test(username);
}

export function passwordProblem(password: string): string | null {
  if (password.length < 8) return "密码至少需要 8 个字符";
  if (password.length > 200) return "密码过长";
  return null;
}

export interface DefinitionInput {
  part_of_speech: string;
  meaning: string;
  example: string;
  note: string;
}

/**
 * Normalises a list of definitions coming from a form or JSON body.
 * Entries without a meaning are dropped; everything is trimmed and capped.
 */
export function parseDefinitions(raw: unknown): DefinitionInput[] {
  if (!Array.isArray(raw)) return [];
  const out: DefinitionInput[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const meaning = asString(record.meaning, 4000);
    if (!meaning) continue;
    out.push({
      part_of_speech: asString(record.part_of_speech, 20) || "n.",
      meaning,
      example: asString(record.example, 4000),
      note: asString(record.note, 4000),
    });
  }
  return out;
}

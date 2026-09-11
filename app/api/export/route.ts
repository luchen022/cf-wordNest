import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { loadWords } from "@/lib/db";
import { ensureUserBootstrap } from "@/lib/lists";

function csvCell(value: string): string {
  const needsQuotes = /[",\n\r]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

/** Exports the current list as CSV (UTF-8 with BOM so Excel opens it correctly). */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });

  const list = await ensureUserBootstrap(user);
  const markedOnly = request.nextUrl.searchParams.get("marked_only") === "true";
  const alphabetical = request.nextUrl.searchParams.get("sort") === "true";

  const words = await loadWords(list.id, { markedOnly, alphabetical });

  const rows = [["单词", "词性", "释义", "例句", "笔记", "是否标注"]];
  for (const entry of words) {
    if (entry.definitions.length === 0) {
      rows.push([entry.word, "", "", "", "", entry.marked ? "是" : "否"]);
      continue;
    }
    for (const definition of entry.definitions) {
      rows.push([
        entry.word,
        definition.part_of_speech,
        definition.meaning,
        definition.example,
        definition.note,
        entry.marked ? "是" : "否",
      ]);
    }
  }

  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  const filename = encodeURIComponent(`${list.name}.csv`);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="words.csv"; filename*=UTF-8''${filename}`,
    },
  });
}

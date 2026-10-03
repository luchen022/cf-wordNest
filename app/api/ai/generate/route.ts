import type { NextRequest } from "next/server";
import { getAiConfig, chatCompletion } from "@/lib/ai";
import { getCurrentUser } from "@/lib/auth";
import { asString } from "@/lib/validate";

const POS_VALUES = [
  "n.",
  "v.",
  "adj.",
  "adv.",
  "prep.",
  "conj.",
  "pron.",
  "interj.",
  "num.",
  "art.",
  "phr.",
];

interface FillResult {
  definitions?: Array<{
    part_of_speech?: string;
    meaning?: string;
    example?: string;
    note?: string;
  }>;
  error?: string;
}

/**
 * Generates study material with the signed-in user's own model provider.
 * Actions: "example", "note", "fill".
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });

  let config;
  try { config = await getAiConfig(user.id); }
  catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "读取 AI 配置失败" }, { status: 400 });
  }
  if (!config) {
    return Response.json({ error: "请先在设置中配置你自己的模型接口（Base URL / 模型 / API Key）" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = asString(body.action, 20);
  const word = asString(body.word, 100);
  const partOfSpeech = asString(body.partOfSpeech, 20);
  const meaning = asString(body.meaning, 4000);

  if (!word) return Response.json({ error: "请先填写单词" }, { status: 400 });

  try {
    if (action === "example") {
      if (!meaning) return Response.json({ error: "请先填写释义" }, { status: 400 });
      const content = await chatCompletion(
        config,
        [
          {
            role: "system",
            content: "你是英语学习助手，擅长为学生写出自然、地道、难度适中的例句。",
          },
          {
            role: "user",
            content: `请为单词 "${word}"（${partOfSpeech}，释义：${meaning}）写一句地道的英语例句，并附上中文翻译。
只输出两行：第一行英文例句，第二行中文翻译。不要任何额外说明。`,
          },
        ],
        { temperature: 0.8, maxTokens: 400 },
      );
      return Response.json({ example: content.trim() });
    }

    if (action === "note") {
      if (!meaning) return Response.json({ error: "请先填写释义" }, { status: 400 });
      const content = await chatCompletion(
        config,
        [
          { role: "system", content: "你是英语学习助手，擅长用巧记法帮中国学生记住单词。" },
          {
            role: "user",
            content: `为英语单词 "${word}"（${partOfSpeech}，释义：${meaning}）写一段 80 字以内的学习笔记，
包含：记忆技巧或联想、常用搭配、易混淆点提醒。只输出笔记正文。`,
          },
        ],
        { temperature: 0.7, maxTokens: 400 },
      );
      return Response.json({ note: content.trim() });
    }

    if (action === "fill") {
      const content = await chatCompletion(
        config,
        [
          {
            role: "system",
            content:
              "你是专业的英语词典编辑。必须只返回合法 JSON。先校验输入是否为合法的英语单词或短语，" +
              "若不是（中文、数字、乱码等）则返回 error 字段。",
          },
          {
            role: "user",
            content: `为英语单词 "${word}" 生成完整学习资料。

要求：
1. 按词性分组，每个词性一个对象；同一词性的多个释义用"；"分隔
2. part_of_speech 必须从这些值中选择：${POS_VALUES.join(" ")}
3. example 字段格式为 "英文例句\\n中文翻译"
4. note 为 80 字以内的记忆技巧、常用搭配
5. 更常用的词性排在前面

只返回如下 JSON（不要 markdown 代码块）：
{"definitions":[{"part_of_speech":"n.","meaning":"释义1；释义2","example":"英文例句\\n中文翻译","note":"学习笔记"}]}

校验失败时返回：{"error":"具体原因"}`,
          },
        ],
        { temperature: 0.4, maxTokens: 1500, json: true },
      );

      const parsed = JSON.parse(content) as FillResult;
      if (parsed.error) return Response.json({ error: parsed.error }, { status: 400 });
      if (!Array.isArray(parsed.definitions) || parsed.definitions.length === 0) {
        return Response.json({ error: "AI 未返回有效的释义，请检查拼写后重试" }, { status: 502 });
      }

      const definitions = parsed.definitions.map((item) => ({
        part_of_speech: POS_VALUES.includes(String(item.part_of_speech)) ? String(item.part_of_speech) : "n.",
        meaning: asString(item.meaning, 4000),
        example: asString(item.example, 4000),
        note: asString(item.note, 4000),
      }));

      return Response.json({ definitions: definitions.filter((item) => item.meaning) });
    }

    return Response.json({ error: "未知的操作" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "调用模型失败";
    console.error(JSON.stringify({ message: "ai generate failed", action, word, error: message }));
    return Response.json({ error: message }, { status: 502 });
  }
}

"use client";

import { useCallback, useEffect, useState } from "react";

interface GraphNode {
  id: string;
  label: string;
  group: string;
  color: string;
  size: number;
  isRoot: boolean;
}

interface GraphEdge {
  from: string;
  to: string;
  label: string;
  color: string;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  cached?: boolean;
  error?: string;
}

const WIDTH = 760;
const HEIGHT = 540;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;
const RADIUS = 200;

export function GraphView({ words }: { words: Array<{ id: number; word: string }> }) {
  const [wordId, setWordId] = useState<number | null>(words[0]?.id ?? null);
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(
    async (id: number, refresh = false) => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/graph?wordId=${id}${refresh ? "&refresh=1" : ""}`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as GraphData;
        if (payload.error) {
          setError(payload.error);
          setData(null);
          return;
        }
        setData(payload);
      } catch {
        setError("加载图谱失败，请重试");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (wordId) void load(wordId);
  }, [wordId, load]);

  const positions = new Map<string, { x: number; y: number }>();
  if (data) {
    const outer = data.nodes.filter((node) => !node.isRoot);
    outer.forEach((node, index) => {
      const angle = (index / Math.max(outer.length, 1)) * Math.PI * 2 - Math.PI / 2;
      positions.set(node.id, {
        x: CENTER_X + Math.cos(angle) * RADIUS,
        y: CENTER_Y + Math.sin(angle) * RADIUS,
      });
    });
    const root = data.nodes.find((node) => node.isRoot);
    if (root) positions.set(root.id, { x: CENTER_X, y: CENTER_Y });
  }

  if (words.length === 0) {
    return (
      <div className="card p-10 text-center">
        <div className="text-4xl">🕸️</div>
        <h2 className="mt-4 text-lg font-semibold">当前词表还没有单词</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">先添加一些单词再来生成图谱</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <select
          className="field max-w-xs"
          value={wordId ?? ""}
          onChange={(event) => setWordId(Number(event.target.value))}
          aria-label="选择中心单词"
        >
          {words.map((word) => (
            <option key={word.id} value={word.id}>
              {word.word}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => wordId && void load(wordId, true)}
          disabled={loading || !wordId}
        >
          🔄 重新生成
        </button>
        {data?.cached ? (
          <span className="chip bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            来自缓存
          </span>
        ) : null}
        {loading ? <span className="text-sm text-slate-400">生成中…</span> : null}
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {data ? (
        <div className="card overflow-hidden p-2">
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full" role="img" aria-label="单词关系图">
            {data.edges.map((edge) => {
              const from = positions.get(edge.from);
              const to = positions.get(edge.to);
              if (!from || !to) return null;
              return (
                <g key={`${edge.from}-${edge.to}-${edge.label}`}>
                  <line
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke={edge.color}
                    strokeWidth={1.5}
                    strokeOpacity={0.5}
                  />
                  <text
                    x={(from.x + to.x) / 2}
                    y={(from.y + to.y) / 2 - 4}
                    textAnchor="middle"
                    fontSize={10}
                    fill={edge.color}
                  >
                    {edge.label}
                  </text>
                </g>
              );
            })}

            {data.nodes.map((node) => {
              const position = positions.get(node.id);
              if (!position) return null;
              return (
                <g key={node.id}>
                  <circle
                    cx={position.x}
                    cy={position.y}
                    r={node.isRoot ? 26 : 18}
                    fill={node.color}
                    fillOpacity={node.isRoot ? 1 : 0.85}
                  />
                  <text
                    x={position.x}
                    y={position.y + (node.isRoot ? 42 : 34)}
                    textAnchor="middle"
                    fontSize={node.isRoot ? 16 : 12}
                    fontWeight={node.isRoot ? 600 : 400}
                    className="fill-slate-700 dark:fill-slate-200"
                  >
                    {node.label}
                  </text>
                </g>
              );
            })}
          </svg>

          <div className="flex flex-wrap justify-center gap-4 pb-3 text-xs text-slate-500 dark:text-slate-400">
            {[
              ["同义", "#22c55e"],
              ["反义", "#ef4444"],
              ["相关", "#3b82f6"],
              ["主题", "#a855f7"],
            ].map(([label, color]) => (
              <span key={label} className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
                {label}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

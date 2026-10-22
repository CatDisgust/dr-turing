"use client";

import { useCallback, useEffect, useState } from "react";
import { EDGE_LEGEND, GraphPanel } from "@/components/graph/graph-panel";
import type { ReviewOp } from "@/lib/graph/review";
import type { CourseGraph } from "@/lib/types";

const KIND_LABEL = {
  concept: "原理",
  design: "设计权衡",
  memory: "记忆",
  procedure: "做法",
} as const;

const LEGEND_COLOR = {
  confusable: "#f59e0b",
  part_of: "#94a3b8",
  prereq: "#64748b",
} as const;

// 课程图谱页：看图，点节点看详情，审阅（合并 / 改名 / 删除）
export function CourseView({ id }: { id: string }) {
  const [graph, setGraph] = useState<CourseGraph | null>(null);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [mergeId, setMergeId] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/course/${id}`)
      .then(async (response) => {
        const body = await response.json();
        if (body.error) {
          setError(body.error);
        } else {
          setGraph(body.graph);
        }
      })
      .catch((e) => setError(String(e)));
  }, [id]);

  const selected = graph?.points.find((p) => p.id === selectedId) ?? null;
  const nameOf = (pointId: string) =>
    graph?.points.find((p) => p.id === pointId)?.name ?? pointId;

  const select = useCallback(
    (pointId: string | null) => {
      setSelectedId(pointId);
      setNewName(graph?.points.find((p) => p.id === pointId)?.name ?? "");
      setMergeId("");
      setConfirmDelete(false);
    },
    [graph]
  );

  const review = useCallback(
    async (op: ReviewOp, nextSelected: string | null) => {
      setBusy(true);
      setError("");
      try {
        const response = await fetch(`/api/course/${id}`, {
          body: JSON.stringify(op),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        const body = await response.json();
        if (body.error) {
          setError(body.error);
        } else {
          setGraph(body.graph);
          setSelectedId(nextSelected);
          setMergeId("");
          setConfirmDelete(false);
          if (op.op === "rename") {
            setNewName(op.name);
          }
        }
      } catch (e) {
        setError(String(e));
      }
      setBusy(false);
    },
    [id]
  );

  const onNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setNewName(e.target.value),
    []
  );
  const onMergeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => setMergeId(e.target.value),
    []
  );
  const onRename = useCallback(() => {
    if (selectedId) {
      review(
        { id: selectedId, name: newName.trim(), op: "rename" },
        selectedId
      );
    }
  }, [review, selectedId, newName]);
  const onMerge = useCallback(() => {
    if (selectedId) {
      review({ drop: mergeId, keep: selectedId, op: "merge" }, selectedId);
    }
  }, [review, selectedId, mergeId]);
  const onDelete = useCallback(() => {
    if (!selectedId) {
      return;
    }
    if (confirmDelete) {
      review({ id: selectedId, op: "delete" }, null);
    } else {
      setConfirmDelete(true);
    }
  }, [review, selectedId, confirmDelete]);

  if (!graph) {
    return (
      <main className="p-8 text-sm">
        {error ? `出错了：${error}` : "加载图谱…"}
      </main>
    );
  }

  const related = selected
    ? graph.edges.filter((e) => e.from === selected.id || e.to === selected.id)
    : [];

  return (
    <div className="flex h-dvh flex-col md:flex-row">
      <div className="relative min-h-[60vh] flex-1">
        <div className="absolute right-3 bottom-3 z-10 space-y-1 rounded border bg-background/90 p-2 text-xs">
          <div className="font-semibold">{graph.name}</div>
          <div className="text-muted-foreground">
            {graph.points.length} 个知识点，{graph.edges.length} 条关系
          </div>
          {EDGE_LEGEND.map((item) => (
            <div className="flex items-center gap-2" key={item.type}>
              <span
                className="inline-block w-6 border-t-2"
                style={{
                  borderColor: LEGEND_COLOR[item.type],
                  borderStyle:
                    item.type === "prereq"
                      ? "solid"
                      : item.type === "part_of"
                        ? "dashed"
                        : "dotted",
                }}
              />
              {item.label}
            </div>
          ))}
        </div>
        <GraphPanel graph={graph} onSelect={select} selectedId={selectedId} />
      </div>

      <aside className="w-full space-y-4 overflow-y-auto border-l p-4 text-sm md:w-96">
        {error ? <p className="text-red-600">出错了：{error}</p> : null}
        {selected ? (
          <>
            <div>
              <h2 className="font-semibold text-base">{selected.name}</h2>
              <p className="text-muted-foreground">
                {KIND_LABEL[selected.kind]}
                {selected.status === "reviewed" ? " · 已审阅" : ""}
                {selected.aliases.length > 0
                  ? ` · ${selected.aliases.join(" / ")}`
                  : ""}
              </p>
              <p className="mt-2">{selected.definition}</p>
            </div>

            <section>
              <h3 className="font-medium">检查题</h3>
              <ul className="list-disc pl-5">
                {selected.checkQuestions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
              {selected.checkQuestions.length === 0 ? (
                <p className="text-muted-foreground">还没有</p>
              ) : null}
            </section>

            <section>
              <h3 className="font-medium">常见误解</h3>
              <ul className="list-disc pl-5">
                {selected.misconceptions.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
              {selected.misconceptions.length === 0 ? (
                <p className="text-muted-foreground">还没有</p>
              ) : null}
            </section>

            <section>
              <h3 className="font-medium">关系</h3>
              {related.map((e) => (
                <p key={`${e.type}:${e.from}:${e.to}`}>
                  {e.type === "prereq"
                    ? e.from === selected.id
                      ? `是「${nameOf(e.to)}」的先修`
                      : `先修：「${nameOf(e.from)}」`
                    : e.type === "part_of"
                      ? e.from === selected.id
                        ? `属于「${nameOf(e.to)}」`
                        : `包含「${nameOf(e.from)}」`
                      : `易和「${nameOf(e.from === selected.id ? e.to : e.from)}」混`}
                </p>
              ))}
            </section>

            <section>
              <h3 className="font-medium">课件出处</h3>
              {selected.sources.map((s) => (
                <p
                  className="text-muted-foreground"
                  key={`${s.lessonId}-${s.page}-${s.quote}`}
                >
                  {s.lessonId.replace("l", "第 ")} 课第 {s.page} 页：{s.quote}
                </p>
              ))}
            </section>

            <section className="space-y-2 border-t pt-3">
              <h3 className="font-medium">审阅</h3>
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded border bg-background px-2 py-1"
                  onChange={onNameChange}
                  value={newName}
                />
                <button
                  className="rounded border px-3 py-1 disabled:opacity-50"
                  disabled={
                    busy || !newName.trim() || newName.trim() === selected.name
                  }
                  onClick={onRename}
                  type="button"
                >
                  改名
                </button>
              </div>
              <div className="flex gap-2">
                <select
                  className="min-w-0 flex-1 rounded border bg-background px-2 py-1"
                  onChange={onMergeChange}
                  value={mergeId}
                >
                  <option value="">把另一个知识点并进来…</option>
                  {graph.lessons.map((lesson) => (
                    <optgroup key={lesson.id} label={`第 ${lesson.index} 课`}>
                      {graph.points
                        .filter(
                          (p) =>
                            p.lessonId === lesson.id && p.id !== selected.id
                        )
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
                <button
                  className="rounded border px-3 py-1 disabled:opacity-50"
                  disabled={busy || !mergeId}
                  onClick={onMerge}
                  type="button"
                >
                  合并
                </button>
              </div>
              <button
                className="rounded border border-red-300 px-3 py-1 text-red-600 disabled:opacity-50"
                disabled={busy}
                onClick={onDelete}
                type="button"
              >
                {confirmDelete ? "再点一次确认删除" : "删除这个知识点"}
              </button>
            </section>
          </>
        ) : (
          <p className="text-muted-foreground">
            点图上的知识点，看它的定义、检查题、误解和出处，也可以在这里合并、改名、删除。
          </p>
        )}
      </aside>
    </div>
  );
}

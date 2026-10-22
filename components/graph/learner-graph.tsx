"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  GraphPanel,
  LIGHT_LEGEND,
  lightSwatch,
} from "@/components/graph/graph-panel";
import {
  COURSE_ID,
  LEARNER_REFRESH_EVENT,
  NODE_TOUCHED_EVENT,
} from "@/lib/constants";
import { type Light, nodeLight } from "@/lib/learner/light";
import type { CourseGraph, LearnerState } from "@/lib/types";

// 聊天右边的图谱：按当前学生的状态点亮。归类一到就先把那个点虚线亮，回答结束再从库里刷新
export function LearnerGraph({ sessionId }: { sessionId: string }) {
  const [graph, setGraph] = useState<CourseGraph | null>(null);
  const [state, setState] = useState<LearnerState | null>(null);
  const [touched, setTouched] = useState<{ kpId: string; name: string }>();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetch(`/api/learner/${COURSE_ID}`)
      .then((response) => response.json())
      .then((body) => setState(body.state))
      .catch(() => {
        /* 刷新失败就保持上一份 */
      });
  }, []);

  useEffect(() => {
    fetch(`/api/course/${COURSE_ID}`)
      .then((response) => response.json())
      .then((body) => setGraph(body.graph ?? null))
      .catch(() => setGraph(null));
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onTouched = (event: Event) => {
      const { detail } = event as CustomEvent<{ kpId: string; name: string }>;
      setTouched(detail);
      setSelectedId(detail.kpId);
      refresh();
    };
    window.addEventListener(NODE_TOUCHED_EVENT, onTouched);
    window.addEventListener(LEARNER_REFRESH_EVENT, refresh);
    return () => {
      window.removeEventListener(NODE_TOUCHED_EVENT, onTouched);
      window.removeEventListener(LEARNER_REFRESH_EVENT, refresh);
    };
  }, [refresh]);

  const lights = useMemo(() => {
    const result: Record<string, Light> = {};
    for (const point of graph?.points ?? []) {
      result[point.id] = nodeLight(state?.nodes[point.id], sessionId).light;
    }
    // 库里还没刷到也先亮起来
    if (touched && result[touched.kpId] === "gray") {
      result[touched.kpId] = "dashed";
    }
    return result;
  }, [graph, state, sessionId, touched]);

  if (!graph) {
    return (
      <div className="p-4 text-muted-foreground text-sm">
        这门课的图谱还没生成。
      </div>
    );
  }

  return (
    <div className="relative h-full w-full" data-testid="learner-graph">
      <GraphPanel
        focusId={touched?.kpId}
        graph={graph}
        lights={lights}
        onSelect={setSelectedId}
        selectedId={selectedId}
      />
      {touched ? (
        <div
          className="absolute top-3 left-3 rounded-md border bg-background/90 px-2 py-1 text-xs"
          data-testid="touched-node"
        >
          这次在问：{touched.name}
        </div>
      ) : null}
      <div className="absolute right-3 bottom-3 flex flex-col gap-1 rounded-md border bg-background/90 p-2 text-xs">
        {LIGHT_LEGEND.map((item) => (
          <div className="flex items-center gap-2" key={item.light}>
            <span style={lightSwatch(item.light)} />
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}

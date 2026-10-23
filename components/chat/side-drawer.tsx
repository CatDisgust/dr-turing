"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { GRADED_EVENT, NODE_TOUCHED_EVENT } from "@/lib/constants";
import { cn } from "@/lib/utils";

type Tab = "material" | "graph";

// 右边的侧拉框：课件和我的图谱两个标签页，可收起。
// 两页都一直挂着（图谱要接收点亮事件、课件要留住打开的 PDF），只是叠在一起切换显示
export function SideDrawer({
  material,
  graph,
  showMaterial,
}: {
  material: ReactNode;
  graph: ReactNode;
  showMaterial: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<Tab>(showMaterial ? "material" : "graph");
  const [graphNews, setGraphNews] = useState(false);
  const current: Tab = showMaterial ? tab : "graph";

  // 窄屏默认收起，不挡对话
  useEffect(() => {
    if (window.innerWidth < 1024) {
      setOpen(false);
    }
  }, []);

  // 看课件时图谱有变化，在“我的图谱”上点个小红点
  useEffect(() => {
    const onNews = () => setGraphNews(true);
    window.addEventListener(NODE_TOUCHED_EVENT, onNews);
    window.addEventListener(GRADED_EVENT, onNews);
    return () => {
      window.removeEventListener(NODE_TOUCHED_EVENT, onNews);
      window.removeEventListener(GRADED_EVENT, onNews);
    };
  }, []);
  const news = graphNews && !(open && current === "graph");

  const pick = useCallback((next: Tab) => {
    setTab(next);
    if (next === "graph") {
      setGraphNews(false);
    }
  }, []);
  const show = useCallback(() => {
    setOpen(true);
    if (news) {
      pick("graph");
    }
  }, [news, pick]);
  const hide = useCallback(() => setOpen(false), []);

  return (
    <>
      {open ? null : (
        <button
          className="fixed top-1/2 right-0 z-30 flex -translate-y-1/2 flex-col items-center gap-1 rounded-l-md border border-r-0 bg-background px-1.5 py-3 text-xs shadow-sm [writing-mode:vertical-rl] hover:bg-muted"
          data-testid="drawer-open"
          onClick={show}
          type="button"
        >
          {showMaterial ? "课件 · 我的图谱" : "我的图谱"}
          {news ? <span className="size-2 rounded-full bg-red-500" /> : null}
        </button>
      )}
      <aside
        className={cn(
          "flex min-w-0 shrink-0 flex-col border-l bg-background",
          "max-lg:fixed max-lg:inset-y-0 max-lg:right-0 max-lg:z-40 max-lg:w-[92vw] max-lg:shadow-xl",
          "lg:w-[44%]",
          !open && "hidden"
        )}
        data-testid="side-drawer"
      >
        <div className="flex items-center gap-1 border-b px-2 py-1.5 text-sm">
          {showMaterial ? (
            <TabButton
              active={current === "material"}
              onPick={pick}
              tab="material"
            >
              课件
            </TabButton>
          ) : null}
          <TabButton active={current === "graph"} onPick={pick} tab="graph">
            我的图谱
            {news ? (
              <span className="ml-1 inline-block size-2 rounded-full bg-red-500" />
            ) : null}
          </TabButton>
          <button
            className="ml-auto rounded-md px-2 py-1 text-muted-foreground text-xs hover:bg-muted"
            data-testid="drawer-close"
            onClick={hide}
            type="button"
          >
            收起 ›
          </button>
        </div>
        <div className="relative min-h-0 flex-1">
          {showMaterial ? (
            <div
              className={cn(
                "absolute inset-0 overflow-hidden bg-background",
                current !== "material" && "pointer-events-none opacity-0"
              )}
              data-testid="pane-material"
            >
              {material}
            </div>
          ) : null}
          <div
            className={cn(
              "absolute inset-0 overflow-hidden bg-background",
              current !== "graph" && "pointer-events-none opacity-0"
            )}
            data-testid="pane-graph"
          >
            {graph}
          </div>
        </div>
      </aside>
    </>
  );
}

function TabButton({
  active,
  onPick,
  tab,
  children,
}: {
  active: boolean;
  onPick: (tab: Tab) => void;
  tab: Tab;
  children: ReactNode;
}) {
  const onClick = useCallback(() => onPick(tab), [onPick, tab]);
  return (
    <button
      className={cn(
        "flex items-center rounded-md px-3 py-1",
        active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted"
      )}
      data-testid={`tab-${tab}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

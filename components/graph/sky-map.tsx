"use client";

import "./star-map.css";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  hashString,
  layoutSky,
  place,
  type Rect,
  type SkyPoint,
  starField,
} from "@/lib/graph/sky";
import { FULL_O } from "@/lib/learner/config";
import type { Light } from "@/lib/learner/light";
import type { CourseGraph } from "@/lib/types";

// 聊天右边的星图（视觉规范「我的星图」，用户 2026-10-23 定：天文馆真实星光，
// 默认整门课一片天，点一课推近到本课近景）。一课一个星座，一个知识点一颗星：
// 还没开始 / 可以学了是小点，看懂是柔光核，真会加外晕和柔和光芒，正在学有呼吸圈，
// 很确定却答错的那颗换成红圈并写「以为会了，还没亮」。星的颜色按真实星温度随机，不表示掌握程度

const BAND_TOP = 16;
const INFO_HEIGHT = 84;
const ZOOM_TOP = 72;
const ANIM_MS = 600;
// 背景暗星：规范按 440×800 的抽屉撒 640 颗，按面积换算
const FIELD_DENSITY = 640 / (440 * 800);

type StarKind = "dim" | "near" | "half" | "full";

const TINTS = ["blue", "white", "orange"] as const;
const TINT_COLOR = {
  blue: "var(--star-blue, #ccdbff)",
  orange: "var(--star-orange, #ffe1bf)",
  white: "var(--star-white, #fffffe)",
} as const;

const STATE_TEXT: Record<StarKind, string> = {
  dim: "还没开始",
  full: "真会",
  half: "看懂",
  near: "可以学了",
};

type Frame = Record<string, Rect & { opacity: number }>;

function useSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ height: 0, width: 0 });
  useEffect(() => {
    const box = ref.current;
    if (!box) {
      return;
    }
    const observer = new ResizeObserver(() =>
      setSize({ height: box.clientHeight, width: box.clientWidth })
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

const ease = (t: number) => 1 - (1 - t) ** 3;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function SkyMap({
  graph,
  lights,
  progress,
  currentId,
  warnId,
  selectedId,
  onSelect,
}: {
  graph: CourseGraph;
  lights: Record<string, Light>;
  // 自主掌握 O：看懂的星外面画一圈细弧，表示离真会还差多少
  progress: Record<string, number>;
  // 这次在问的点
  currentId?: string;
  // 很确定却答错的点
  warnId?: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const uid = useId().replace(/:/g, "");
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { width, height } = useSize(boxRef);
  const layout = useMemo(() => layoutSky(graph), [graph]);
  const lessonOf = useMemo(
    () => new Map(graph.points.map((p) => [p.id, p.lessonId])),
    [graph]
  );
  const nameOf = useMemo(
    () => new Map(graph.points.map((p) => [p.id, p.name])),
    [graph]
  );

  // 每颗星画成哪种：亮度来自学生状态；灰的里面，先修都亮了的算“可以学了”
  const kinds = useMemo(() => {
    const result: Record<string, StarKind> = {};
    const lit = (id: string) => lights[id] === "half" || lights[id] === "full";
    for (const point of graph.points) {
      const light = lights[point.id] ?? "gray";
      if (light === "full" || light === "half") {
        result[point.id] = light;
        continue;
      }
      const prereqs = graph.edges.filter(
        (e) => e.type === "prereq" && e.to === point.id
      );
      result[point.id] =
        light === "dashed" ||
        (prereqs.length > 0 && prereqs.every((e) => lit(e.from)))
          ? "near"
          : "dim";
    }
    return result;
  }, [graph, lights]);

  // 视图：null 是整门课，否则是推近的那一课。切换时 600ms 从旧画面滑到新画面
  const [view, setView] = useState<string | null>(null);
  const [anim, setAnim] = useState({
    from: null as string | null,
    t: 1,
    to: null as string | null,
  });
  const go = useCallback(
    (next: string | null) => {
      if (next === view) {
        return;
      }
      setView(next);
      const reduce = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;
      if (reduce) {
        setAnim({ from: next, t: 1, to: next });
        return;
      }
      const start = performance.now();
      const from = view;
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / ANIM_MS);
        setAnim({ from, t, to: next });
        if (t < 1) {
          requestAnimationFrame(step);
        }
      };
      requestAnimationFrame(step);
    },
    [view]
  );

  const frameOf = useCallback(
    (target: string | null): Frame => {
      const frame: Frame = {};
      const { lessons } = layout;
      if (target === null) {
        const band = (height - BAND_TOP - INFO_HEIGHT) / lessons.length;
        lessons.forEach((lesson, i) => {
          const top = BAND_TOP + i * band;
          frame[lesson.id] = {
            height: band - 34,
            opacity: 1,
            width: width - 68,
            x: 34,
            y: top + 26,
          };
        });
        return frame;
      }
      const zoom = {
        height: height - ZOOM_TOP - INFO_HEIGHT - 16,
        width: width - 84,
        x: 30,
        y: ZOOM_TOP,
      };
      const at = lessons.findIndex((l) => l.id === target);
      lessons.forEach((lesson, i) => {
        frame[lesson.id] = {
          ...zoom,
          opacity: i === at ? 1 : 0,
          y: zoom.y + (i - at) * height,
        };
      });
      return frame;
    },
    [layout, width, height]
  );

  const frame = useMemo(() => {
    const a = frameOf(anim.from);
    const b = frameOf(anim.to);
    const t = ease(anim.t);
    const result: Frame = {};
    for (const id of Object.keys(b)) {
      result[id] = {
        height: lerp(a[id].height, b[id].height, t),
        opacity: lerp(a[id].opacity, b[id].opacity, t),
        width: lerp(a[id].width, b[id].width, t),
        x: lerp(a[id].x, b[id].x, t),
        y: lerp(a[id].y, b[id].y, t),
      };
    }
    return result;
  }, [frameOf, anim]);

  const pos = useCallback(
    (id: string): SkyPoint | null => {
      const rect = frame[lessonOf.get(id) ?? ""];
      const unit = layout.unit[id];
      return rect && unit ? place(unit, rect) : null;
    },
    [frame, lessonOf, layout]
  );

  // 背景暗星画在 canvas 上，尺寸变了重画
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!(canvas && width && height)) {
      return;
    }
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.scale(ratio, ratio);
    ctx.clearRect(0, 0, width, height);
    const count = Math.round(FIELD_DENSITY * width * height);
    for (const star of starField(count, width, height)) {
      ctx.globalAlpha = star.alpha;
      ctx.fillStyle = star.color;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [width, height]);

  // 亮度比上次高的星闪一下（D12 点亮动画）
  const previous = useRef<Record<string, Light> | undefined>(undefined);
  const [flashing, setFlashing] = useState<string[]>([]);
  useEffect(() => {
    const before = previous.current;
    previous.current = lights;
    if (!before) {
      return;
    }
    const rank = { dashed: 1, full: 3, gray: 0, half: 2 } as const;
    const raised = Object.keys(lights).filter(
      (id) => rank[lights[id]] > rank[before[id] ?? "gray"]
    );
    if (raised.length === 0) {
      return;
    }
    setFlashing(raised);
    const timer = setTimeout(() => setFlashing([]), 1600);
    return () => clearTimeout(timer);
  }, [lights]);

  // 按 Esc：先取消选中，再退回整门课
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (selectedId) {
        onSelect(null);
      } else if (view) {
        go(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onSelect, selectedId, view]);

  const zoomed = anim.to !== null;
  const back = useCallback(() => go(null), [go]);
  const prereqLines = currentId
    ? graph.edges.filter(
        (e) => e.type === "prereq" && e.to === currentId && isLit(kinds[e.from])
      )
    : [];
  const fullCount = (ids: string[]) =>
    ids.filter((id) => kinds[id] === "full").length;
  const allIds = graph.points.map((p) => p.id);
  const focusId = selectedId ?? currentId ?? null;
  const zoomLesson = layout.lessons.find((l) => l.id === anim.to);

  const showLabel = useCallback(
    (id: string) =>
      zoomed
        ? frame[lessonOf.get(id) ?? ""]?.opacity > 0.5
        : id === currentId || id === warnId || id === selectedId,
    [zoomed, frame, lessonOf, currentId, warnId, selectedId]
  );

  // 名字摆哪边：每颗星试 8 个位置，挑压到别的名字、别的星、星座连线最少的那个；
  // 怎么摆都会压到别的名字或星，就先不写名字（悬停能看到，点了会写出来）。
  // 正在学、答错、选中的星先摆，保证它们的名字一定在。视图停稳了才算，动画中都写右边
  const placements = useMemo(() => {
    const result: Record<string, Placement | null> = {};
    if (anim.t < 1) {
      return result;
    }
    const shown = (id: string) =>
      (frame[lessonOf.get(id) ?? ""]?.opacity ?? 0) > 0.5;
    const visible = graph.points
      .map((p) => ({ id: p.id, name: p.name, p: pos(p.id) }))
      .filter(
        (v): v is { id: string; name: string; p: SkyPoint } =>
          v.p !== null && shown(v.id)
      );
    const stars: Box[] = visible.map((v) => around(v.p, STAR_GAP));
    const segments: [SkyPoint, SkyPoint][] = [];
    for (const lesson of layout.lessons) {
      for (const [a, b] of lesson.lines) {
        const pa = pos(a);
        const pb = pos(b);
        if (pa && pb && shown(a) && shown(b)) {
          segments.push([pa, pb]);
        }
      }
    }
    const labels: Box[] = [];
    const first = (id: string) =>
      id === currentId || id === warnId || id === selectedId ? 0 : 1;
    const labelled = visible
      .filter((v) => showLabel(v.id))
      .sort(
        (a, b) => first(a.id) - first(b.id) || a.p.y - b.p.y || a.p.x - b.p.x
      );
    for (const v of labelled) {
      const big = v.id === currentId || v.id === warnId;
      // 答错那颗名字下面还有一行「以为会了，还没亮」：宽度取两行里更宽的，免得靠边时第二行伸出画面
      const lines = v.id === warnId ? 2 : 1;
      const w = Math.max(
        textWidth(v.name) * (big ? 1.12 : 1),
        lines === 2 ? textWidth(WARN_TEXT) : 0
      );
      let best: { box: Box; cost: number; placement: Placement } | null = null;
      for (const [rank, placement] of PLACEMENTS.entries()) {
        const box = labelBox(placement, v.p, w, lines);
        if (box.x1 < 4 || box.x2 > width - 6) {
          continue;
        }
        const crowd =
          labels.filter((l) => overlaps(l, box)).length +
          stars.filter((st, i) => visible[i].id !== v.id && overlaps(st, box))
            .length;
        const crossed = segments.filter(([pa, pb]) =>
          segmentHits(pa, pb, box)
        ).length;
        const cost = crowd * 100 + crossed * 20 + rank;
        if (!best || cost < best.cost) {
          best = { box, cost, placement };
        }
      }
      if (!best || (best.cost >= 100 && first(v.id) === 1)) {
        result[v.id] = null;
        continue;
      }
      result[v.id] = best.placement;
      labels.push(best.box);
    }
    return result;
  }, [
    anim.t,
    graph,
    layout,
    pos,
    frame,
    lessonOf,
    width,
    showLabel,
    currentId,
    warnId,
    selectedId,
  ]);

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-[var(--sky)] text-[var(--sky-ink)]"
      data-testid="star-map"
      ref={boxRef}
    >
      <canvas
        className="pointer-events-none absolute inset-0 h-full w-full"
        ref={canvasRef}
      />
      {width > 0 ? (
        // biome-ignore lint/a11y/useSemanticElements: SVG 里没有 fieldset，用 role="group" 给星空起名
        <svg
          aria-label={
            zoomed
              ? `第 ${zoomLesson?.index} 课近景`
              : "整门课的星空，一课一个星座"
          }
          className="absolute inset-0"
          height={height}
          role="group"
          width={width}
        >
          <SkyDefs uid={uid} />

          {layout.lessons.map((lesson, i) => {
            const rect = frame[lesson.id];
            if (!rect || rect.opacity < 0.01) {
              return null;
            }
            const band =
              (height - BAND_TOP - INFO_HEIGHT) / layout.lessons.length;
            const caption = `第 ${lesson.index} 课`;
            const full = fullCount(lesson.pointIds);
            const started = lesson.pointIds.some(
              (id) => kinds[id] === "half" || kinds[id] === "full"
            );
            return (
              <g key={lesson.id} opacity={rect.opacity}>
                {zoomed ? null : (
                  <LessonHit
                    height={band}
                    lessonId={lesson.id}
                    onPick={go}
                    title={`${caption}：${lesson.title}，点开看近景`}
                    width={width}
                    y={BAND_TOP + i * band}
                  />
                )}
                {zoomed ? null : (
                  <text
                    className="pointer-events-none"
                    fill="var(--sky-ink-3)"
                    fontSize={11}
                    letterSpacing={2}
                    x={22}
                    y={rect.y - 10}
                  >
                    {caption} · {started ? `${full} 真会` : "还没开始"}
                  </text>
                )}
                {lesson.lines.map(([a, b]) => {
                  const pa = pos(a);
                  const pb = pos(b);
                  if (!(pa && pb)) {
                    return null;
                  }
                  const bright = isLit(kinds[a]) && isLit(kinds[b]);
                  return (
                    <line
                      key={`${a}-${b}`}
                      stroke={bright ? "#ffffff" : "var(--sky-line)"}
                      strokeLinecap="round"
                      strokeOpacity={bright ? 0.35 : 0.14}
                      x1={pa.x}
                      x2={pb.x}
                      y1={pa.y}
                      y2={pb.y}
                    />
                  );
                })}
              </g>
            );
          })}

          {/* 已会的先修连到正在学的那颗：虚线 */}
          {prereqLines.map((e) => {
            const pa = pos(e.from);
            const pb = pos(e.to);
            const opacity = Math.min(
              frame[lessonOf.get(e.from) ?? ""]?.opacity ?? 0,
              frame[lessonOf.get(e.to) ?? ""]?.opacity ?? 0
            );
            if (!(pa && pb) || opacity < 0.01) {
              return null;
            }
            return (
              <line
                key={`pre-${e.from}`}
                stroke="#ffffff"
                strokeDasharray="3 5"
                strokeOpacity={0.33 * opacity}
                x1={pa.x}
                x2={pb.x}
                y1={pa.y}
                y2={pb.y}
              />
            );
          })}

          {graph.points.map((point) => {
            const p = pos(point.id);
            const opacity = frame[point.lessonId]?.opacity ?? 0;
            if (!p || opacity < 0.01) {
              return null;
            }
            return (
              <SkyStar
                current={point.id === currentId}
                flash={flashing.includes(point.id)}
                id={point.id}
                key={point.id}
                kind={kinds[point.id]}
                label={
                  showLabel(point.id) && placements[point.id] !== null
                    ? point.name
                    : undefined
                }
                name={point.name}
                o={progress[point.id]}
                onSelect={onSelect}
                opacity={opacity}
                placement={placements[point.id] ?? "right"}
                selected={point.id === selectedId}
                uid={uid}
                warn={point.id === warnId}
                x={p.x}
                y={p.y}
              />
            );
          })}
        </svg>
      ) : null}

      {zoomLesson ? (
        <div
          className="absolute top-0 right-0 left-0 flex flex-col gap-1 px-[22px] pt-3.5"
          style={{ opacity: ease(anim.t) }}
        >
          <button
            className="self-start text-[13px] text-[var(--sky-ink-2)] hover:text-[var(--sky-ink)]"
            data-testid="sky-back"
            onClick={back}
            type="button"
          >
            ← 整门课
          </button>
          <span className="text-[15px] text-white">
            第 {zoomLesson.index} 课 · {zoomLesson.title}
          </span>
        </div>
      ) : null}

      <div className="pointer-events-none absolute right-[22px] bottom-5 left-[22px] flex flex-col gap-0.5 text-[13px] text-[var(--sky-ink-2)]">
        {focusId ? (
          <>
            <span className="text-[16px] text-white" data-testid="sky-focus">
              {nameOf.get(focusId)}
            </span>
            <span>
              {focusLine({
                current: focusId === currentId,
                graph,
                id: focusId,
                kinds,
                warn: focusId === warnId,
              })}
            </span>
          </>
        ) : (
          <span>
            {zoomLesson
              ? `第 ${zoomLesson.index} 课 · ${fullCount(zoomLesson.pointIds)} / ${zoomLesson.pointIds.length} 真会`
              : `全课 ${fullCount(allIds)} / ${allIds.length} 真会 · 点一课看近景`}
          </span>
        )}
      </div>
    </div>
  );
}

type Placement =
  | "right"
  | "left"
  | "below"
  | "above"
  | "ne"
  | "se"
  | "nw"
  | "sw";
type Box = { x1: number; x2: number; y1: number; y2: number };

// 先右后左，再上下，最后斜着放；排在前面的同样干净时优先
const PLACEMENTS: Placement[] = [
  "right",
  "left",
  "below",
  "above",
  "ne",
  "se",
  "nw",
  "sw",
];
const LABEL_AT: Record<
  Placement,
  { x: number; y: number; anchor: "start" | "end" | "middle" }
> = {
  above: { anchor: "middle", x: 0, y: -14 },
  below: { anchor: "middle", x: 0, y: 24 },
  left: { anchor: "end", x: -12, y: 4 },
  ne: { anchor: "start", x: 8, y: -11 },
  nw: { anchor: "end", x: -8, y: -11 },
  right: { anchor: "start", x: 12, y: 4 },
  se: { anchor: "start", x: 8, y: 20 },
  sw: { anchor: "end", x: -8, y: 20 },
};

// 答错的星名字下面那行字
const WARN_TEXT = "以为会了，还没亮";

// 名字离别的星至少隔这么远（星本身加选中圈的大小）
const STAR_GAP = 10;

const around = (p: SkyPoint, r: number): Box => ({
  x1: p.x - r,
  x2: p.x + r,
  y1: p.y - r,
  y2: p.y + r,
});

// 估名字宽度：汉字和全角标点 12.5px，字母数字 7px
function textWidth(text: string) {
  let w = 0;
  for (const ch of text) {
    w += ch.charCodeAt(0) > 0x2e_80 ? 12.5 : 7;
  }
  return w;
}

function labelBox(
  placement: Placement,
  p: SkyPoint,
  w: number,
  lines = 1
): Box {
  const at = LABEL_AT[placement];
  const left =
    at.anchor === "start"
      ? p.x + at.x
      : at.anchor === "end"
        ? p.x + at.x - w
        : p.x - w / 2;
  return {
    x1: left - 3,
    x2: left + w + 3,
    y1: p.y + at.y - 13,
    y2: p.y + at.y + 4 + (lines - 1) * 17,
  };
}

// 一条连线有没有穿过名字的框：端点在框里，或者和框的四条边相交
function segmentHits(a: SkyPoint, b: SkyPoint, box: Box) {
  const inside = (p: SkyPoint) =>
    p.x > box.x1 && p.x < box.x2 && p.y > box.y1 && p.y < box.y2;
  if (inside(a) || inside(b)) {
    return true;
  }
  const corners: SkyPoint[] = [
    { x: box.x1, y: box.y1 },
    { x: box.x2, y: box.y1 },
    { x: box.x2, y: box.y2 },
    { x: box.x1, y: box.y2 },
  ];
  return corners.some((c, i) => crosses(a, b, c, corners[(i + 1) % 4]));
}

function crosses(a: SkyPoint, b: SkyPoint, c: SkyPoint, d: SkyPoint) {
  const side = (p: SkyPoint, q: SkyPoint, r: SkyPoint) =>
    Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b);
}

const overlaps = (a: Box, b: Box) =>
  a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

const isLit = (kind: StarKind | undefined) =>
  kind === "half" || kind === "full";

function focusLine({
  graph,
  id,
  kinds,
  current,
  warn,
}: {
  graph: CourseGraph;
  id: string;
  kinds: Record<string, StarKind>;
  current: boolean;
  warn: boolean;
}) {
  const lesson = graph.lessons.find(
    (l) => l.id === graph.points.find((p) => p.id === id)?.lessonId
  );
  const state = warn
    ? "以为会了，还没亮"
    : current && kinds[id] !== "full"
      ? "正在学"
      : STATE_TEXT[kinds[id]];
  const prereqs = graph.edges.filter((e) => e.type === "prereq" && e.to === id);
  const known = prereqs.filter((e) => kinds[e.from] === "full").length;
  const prereqText =
    prereqs.length === 0
      ? ""
      : known === prereqs.length
        ? " · 先修都已真会"
        : ` · 先修 ${known} / ${prereqs.length} 真会`;
  return `第 ${lesson?.index ?? "?"} 课 · ${state}${prereqText}`;
}

// 整门课视图里一课那条横带：点空白处推近到这一课
function LessonHit({
  lessonId,
  onPick,
  title,
  y,
  width,
  height,
}: {
  lessonId: string;
  onPick: (id: string) => void;
  title: string;
  y: number;
  width: number;
  height: number;
}) {
  const pick = useCallback(() => onPick(lessonId), [onPick, lessonId]);
  const key = useCallback(
    (event: KeyboardEvent<SVGRectElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        pick();
      }
    },
    [pick]
  );
  return (
    // biome-ignore lint/a11y/useSemanticElements: SVG 里放不了 <button>，用 role="button" 加键盘操作
    <rect
      aria-label={title}
      className="sky-lesson cursor-zoom-in"
      data-testid={`sky-lesson-${lessonId}`}
      fill="transparent"
      height={height}
      onClick={pick}
      onKeyDown={key}
      role="button"
      tabIndex={0}
      width={width}
      x={0}
      y={y}
    >
      <title>{title}</title>
    </rect>
  );
}

function SkyStar({
  id,
  name,
  placement,
  kind,
  x,
  y,
  label,
  current,
  warn,
  selected,
  flash,
  o,
  opacity,
  uid,
  onSelect,
}: {
  id: string;
  name: string;
  placement: Placement;
  kind: StarKind;
  x: number;
  y: number;
  label?: string;
  current: boolean;
  warn: boolean;
  selected: boolean;
  flash: boolean;
  o?: number;
  opacity: number;
  uid: string;
  onSelect: (id: string) => void;
}) {
  const h = hashString(id);
  const tint = TINTS[h % TINTS.length];
  const size = (h % 100) / 100;
  const pick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      onSelect(id);
    },
    [id, onSelect]
  );
  const key = useCallback(
    (event: KeyboardEvent<SVGGElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        onSelect(id);
      }
    },
    [id, onSelect]
  );
  const ring = Math.min((o ?? 0) / FULL_O, 1);
  const arc = 2 * Math.PI * 9;
  const at = LABEL_AT[placement];

  return (
    // biome-ignore lint/a11y/useSemanticElements: SVG 里放不了 <button>，用 role="button" 加键盘操作
    <g
      aria-label={`${name}，${warn ? "以为会了" : current ? "正在学" : STATE_TEXT[kind]}`}
      className="sky-star cursor-pointer"
      data-testid={`sky-star-${id}`}
      onClick={pick}
      onKeyDown={key}
      opacity={opacity}
      role="button"
      tabIndex={0}
      transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}
    >
      {label ? null : <title>{name}</title>}
      <circle fill="transparent" r={14} />
      <circle
        className="sky-hover"
        fill="none"
        r={15}
        stroke="var(--sky-ink-2)"
        strokeWidth={1}
        style={selected ? { opacity: 1 } : undefined}
      />
      {kind === "dim" ? <circle fill="var(--sky-star-dim)" r={1.3} /> : null}
      {kind === "near" ? <circle fill="var(--sky-star-near)" r={1.4} /> : null}
      {kind === "half" ? (
        <circle fill={`url(#${uid}-core-${tint})`} r={3.6 + size * 1.6} />
      ) : null}
      {kind === "full" ? (
        <>
          <circle fill={`url(#${uid}-halo)`} r={22} />
          <rect
            fill={`url(#${uid}-ray-h)`}
            height={1.2}
            width={34 + size * 6}
            x={-(34 + size * 6) / 2}
            y={-0.6}
          />
          <rect
            fill={`url(#${uid}-ray-v)`}
            height={34 + size * 6}
            width={1.2}
            x={-0.6}
            y={-(34 + size * 6) / 2}
          />
          <circle fill={`url(#${uid}-core-${tint})`} r={6 + size} />
        </>
      ) : null}
      {kind === "half" && ring > 0 ? (
        <circle
          data-testid="o-ring"
          fill="none"
          r={9}
          stroke="#ffffff"
          strokeDasharray={`${arc * ring} ${arc}`}
          strokeOpacity={0.3}
          strokeWidth={1}
          style={{ transition: "stroke-dasharray 0.8s ease-out" }}
          transform="rotate(-90)"
        >
          <title>{`离真会还差 ${Math.round((1 - ring) * 100)}%`}</title>
        </circle>
      ) : null}
      {current || warn ? (
        <>
          <circle
            className="sky-breathe"
            fill="none"
            r={warn ? 13 : 12}
            stroke={warn ? "var(--sky-warn-ring)" : "#ffffff"}
            strokeWidth={warn ? 1.5 : 1}
          />
          {kind === "dim" || kind === "near" ? (
            <circle fill="var(--sky-ink)" r={1.7} />
          ) : null}
        </>
      ) : null}
      {flash ? (
        <circle
          className="star-ripple"
          fill="none"
          r={6}
          stroke="#ffffff"
          strokeWidth={1.5}
        />
      ) : null}
      {label ? (
        <text
          className="pointer-events-none"
          fill={
            current || warn
              ? "#ffffff"
              : kind === "dim"
                ? "var(--sky-ink-3)"
                : "var(--sky-ink)"
          }
          fontSize={current || warn ? 13.5 : 12}
          textAnchor={at.anchor}
          x={at.x}
          y={at.y}
        >
          {label}
        </text>
      ) : null}
      {warn && label ? (
        <text
          className="pointer-events-none"
          fill="var(--sky-warn)"
          fontSize={12}
          textAnchor={at.anchor}
          x={at.x}
          y={at.y + 17}
        >
          {WARN_TEXT}
        </text>
      ) : null}
    </g>
  );
}

// 星的柔光核（中心白，往外淡到真实星色）、真会的外晕和两道两头淡出的光芒
function SkyDefs({ uid }: { uid: string }) {
  return (
    <defs>
      {TINTS.map((tint) => (
        <radialGradient id={`${uid}-core-${tint}`} key={tint}>
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.3" stopColor={TINT_COLOR[tint]} stopOpacity={0.9} />
          <stop offset="1" stopColor={TINT_COLOR[tint]} stopOpacity={0} />
        </radialGradient>
      ))}
      <radialGradient id={`${uid}-halo`}>
        <stop offset="0" stopColor="#ffffff" stopOpacity={0.08} />
        <stop offset="1" stopColor="#ffffff" stopOpacity={0} />
      </radialGradient>
      <linearGradient id={`${uid}-ray-h`} x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stopColor="#ffffff" stopOpacity={0} />
        <stop offset="0.5" stopColor="#ffffff" stopOpacity={0.85} />
        <stop offset="1" stopColor="#ffffff" stopOpacity={0} />
      </linearGradient>
      <linearGradient id={`${uid}-ray-v`} x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#ffffff" stopOpacity={0} />
        <stop offset="0.5" stopColor="#ffffff" stopOpacity={0.85} />
        <stop offset="1" stopColor="#ffffff" stopOpacity={0} />
      </linearGradient>
    </defs>
  );
}

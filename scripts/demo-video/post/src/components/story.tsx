import type { ReactNode } from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { C, FONT } from "../theme";
import { Star } from "./sky";

// 开场动画（一张字卡里演完，配音分 4 段）：
// ① 某 AI 助手（示意）讲得飞快，学生连说“懂了！”，每句旁边亮半颗星
// ② 聊天缩到左边，右边柱状图：用 AI 练习 +48%（以没用过 AI 的同学为 0 线）
// ③ 音乐停，“然后呢？”；AI 窗口被一把拿走，换成一张空白考卷；考试 −17% 砸下去
// ④ 盖章「AI 让你以为学会了」；只给提示的 AI 辅导那根柱子贴着 0 线；最后只剩“看懂了？真会了？”
// 时间点（镜头内秒数）由 data/animatic.ts 的 story() 按配音算好放在 beats 里。
// 60 秒版没有 s2：beats 里就没有 bar3、words、understood、mastered，这几步都不出现
// （beats 里不能放 Infinity：props 序列化成 JSON 时会变成 null；
// 这里也不用 Infinity：interpolate 只收有限的数，所以“不出现”就是一个很远的时刻）
const NEVER = 1e6;

export const AI_TEXT =
  "死锁是指两个或多个事务互相等待对方持有的锁，谁也无法继续执行。它的产生需要同时满足四个条件：互斥、占有并等待、不可抢占、循环等待。数据库通常用等待图来检测死锁，再选一个事务回滚来解除……";
const QUESTION = "死锁是怎么回事？";
const OKS = ["懂了！", "懂了懂了！", "完全懂了！！"];
const CITE =
  "土耳其近千名高中生 · 数学课对照实验 · 都和没用过 AI 的同学比 · Bastani 等，PNAS 2025";
const TUTOR_NOTE = "同一实验：只给提示、不给答案的 AI 辅导，伤害基本消失";

export const STORY_TEXT = `${AI_TEXT}${QUESTION}${OKS.join("")}${CITE}${TUTOR_NOTE}AI 助手示意考试第3题死锁是怎么发生的？然后呢没用过的同学用练习拿走只给提示辅导看懂了真会了让你以为学会了+−%0123456789`;

function useT() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return { fps, frame, t: frame / fps };
}

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const easeOut = (p: number) => 1 - (1 - p) ** 3;

function ramp(t: number, at: number, len: number) {
  return easeOut(interpolate(t, [at, at + len], [0, 1], clamp));
}

function useSpring(at: number, damping = 13) {
  const { fps, frame } = useT();
  return spring({
    config: { damping, mass: 0.6 },
    fps,
    frame: frame - Math.round(at * fps),
  });
}

// 一个从小弹出来的元素
function Pop({
  at,
  children,
  from = 0.5,
}: {
  at: number;
  children: ReactNode;
  from?: number;
}) {
  const s = useSpring(at);
  return (
    <div
      style={{
        opacity: Math.min(1, s * 1.6),
        transform: `scale(${from + (1 - from) * s})`,
        transformOrigin: "right center",
      }}
    >
      {children}
    </div>
  );
}

function Chat({ b }: { b: Record<string, number> }) {
  const { t } = useT();
  const shown = Math.round(
    AI_TEXT.length *
      interpolate(t, [b.stream0 ?? 0.3, b.stream1 ?? 3], [0, 1], clamp)
  );
  const caret = shown < AI_TEXT.length && Math.floor(t * 6) % 2 === 0;
  const bubble = {
    borderRadius: 22,
    fontSize: 32,
    padding: "12px 24px",
  } as const;
  return (
    <div
      style={{
        background: "#1B222D",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 28,
        boxShadow: "0 30px 90px rgba(0,0,0,0.55)",
        color: C.textOnSky,
        display: "flex",
        flexDirection: "column",
        fontFamily: FONT,
        gap: 22,
        padding: "28px 36px 36px",
        width: 1000,
      }}
    >
      <div style={{ alignItems: "center", display: "flex", gap: 16 }}>
        <div
          style={{
            alignItems: "center",
            background: "#3A4556",
            borderRadius: 999,
            display: "flex",
            fontSize: 22,
            fontWeight: 700,
            height: 48,
            justifyContent: "center",
            width: 48,
          }}
        >
          AI
        </div>
        <div style={{ fontSize: 30, fontWeight: 700 }}>AI 助手</div>
        <div
          style={{
            border: "1px solid rgba(255,255,255,0.3)",
            borderRadius: 999,
            color: C.textOnSkySoft,
            fontSize: 22,
            marginLeft: "auto",
            padding: "2px 14px",
          }}
        >
          示意
        </div>
      </div>
      <div
        style={{
          ...bubble,
          alignSelf: "flex-end",
          background: "#2F6FEB",
        }}
      >
        {QUESTION}
      </div>
      <div
        style={{
          color: "#D5DBE5",
          fontSize: 30,
          height: 4 * 30 * 1.6,
          lineHeight: 1.6,
          overflow: "hidden",
        }}
      >
        {AI_TEXT.slice(0, shown)}
        {caret ? "▍" : ""}
      </div>
      <div
        style={{
          alignItems: "flex-end",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          minHeight: 3 * 66,
        }}
      >
        {OKS.map((text, i) => {
          const at = b[`ok${i + 1}`] ?? 1 + i;
          return t >= at - 0.05 ? (
            <Pop at={at} key={text}>
              <div
                style={{
                  alignItems: "center",
                  display: "flex",
                  gap: 12,
                }}
              >
                <Star level="half" size={56} />
                <div style={{ ...bubble, background: "#2F6FEB" }}>{text}</div>
              </div>
            </Pop>
          ) : null;
        })}
      </div>
    </div>
  );
}

// 空白考卷：光标在第一行闪
function Exam({ t }: { t: number }) {
  const caret = Math.floor(t * 2.2) % 2 === 0;
  const line = {
    borderBottom: "3px solid #C9CFD9",
    height: 64,
  } as const;
  return (
    <div
      style={{
        background: "#F7F4EC",
        borderRadius: 18,
        boxShadow: "0 30px 90px rgba(0,0,0,0.55)",
        color: C.ink,
        fontFamily: FONT,
        padding: "40px 56px 56px",
        width: 820,
      }}
    >
      <div style={{ color: C.inkSoft, fontSize: 30 }}>考试 · 第 3 题</div>
      <div style={{ fontSize: 46, fontWeight: 700, marginTop: 14 }}>
        死锁是怎么发生的？
      </div>
      <div style={{ ...line, marginTop: 28, position: "relative" }}>
        <div
          style={{
            background: C.ink,
            bottom: 10,
            height: 44,
            left: 4,
            opacity: caret ? 1 : 0,
            position: "absolute",
            width: 4,
          }}
        />
      </div>
      <div style={line} />
      <div style={line} />
    </div>
  );
}

// 柱状图：0 线是“没用过 AI 的同学”；1% 画 6.2 像素
const PX = 6.2;
const BASE_Y = 630;
const BAR_W = 150;

// 柱子跟着配音长：从念到“用 AI 练习”（“考试”）开始越长越快，念到数字那一刻到头，再弹一下
function grow(t: number, from: number, land: number) {
  if (t <= from) {
    return 0;
  }
  if (t < land) {
    return ((t - from) / (land - from)) ** 2;
  }
  const d = t - land;
  return 1 + 0.08 * Math.sin(d * 18) * Math.exp(-d * 7);
}

function Bar({
  x,
  value,
  g,
  shown,
  color,
  label,
  text,
}: {
  x: number;
  value: number;
  g: number;
  shown: number;
  color: string;
  label: string;
  text: ReactNode;
}) {
  const h = Math.abs(value) * PX * g;
  const up = value >= 0;
  return (
    <>
      <div
        style={{
          background: color,
          borderRadius: up ? "10px 10px 0 0" : "0 0 10px 10px",
          height: h,
          left: x - BAR_W / 2,
          position: "absolute",
          top: up ? BASE_Y - h : BASE_Y,
          width: BAR_W,
        }}
      />
      <div
        style={{
          color,
          fontSize: 92,
          fontWeight: 700,
          left: x - 200,
          opacity: g > 0 ? 1 : 0,
          position: "absolute",
          textAlign: "center",
          top: up ? BASE_Y - h - 120 : BASE_Y + h + 4,
          width: 400,
        }}
      >
        {text}
      </div>
      <div
        style={{
          color: C.textOnSky,
          fontSize: 32,
          left: x - 200,
          opacity: shown,
          position: "absolute",
          textAlign: "center",
          top: up ? BASE_Y + 16 : BASE_Y - 56,
          width: 400,
        }}
      >
        {label}
      </div>
    </>
  );
}

function Count({ value, p }: { value: number; p: number }) {
  const v = Math.round(Math.abs(value) * Math.min(1, p));
  return (
    <span>
      {value >= 0 ? "+" : "−"}
      {v}%
    </span>
  );
}

function Chart({ b, t }: { b: Record<string, number>; t: number }) {
  const axis = ramp(t, b.chartIn ?? 3.6, 0.5);
  const g1 = grow(t, b.bar1From ?? 5, b.bar1 ?? 6);
  const g2 = grow(t, b.bar2From ?? 10, b.bar2 ?? 11);
  const g3 = ramp(t, b.bar3 ?? NEVER, 0.4);
  // 只给提示的 AI 辅导那根出来时，前两根暗一点
  const back = 1 - 0.5 * g3;
  return (
    <AbsoluteFill style={{ fontFamily: FONT }}>
      <div
        style={{
          borderTop: "3px dashed rgba(200,210,230,0.55)",
          left: 1000,
          opacity: axis,
          position: "absolute",
          top: BASE_Y,
          width: 840 * axis,
        }}
      />
      <div
        style={{
          color: C.textOnSkySoft,
          fontSize: 26,
          left: 1000,
          opacity: axis,
          position: "absolute",
          top: BASE_Y + 12,
        }}
      >
        没用过 AI 的同学
      </div>
      <div style={{ opacity: back }}>
        <Bar
          color={C.green}
          g={g1}
          label="用 AI 练习"
          shown={axis}
          text={<Count p={g1} value={48} />}
          value={48}
          x={1350}
        />
        <Bar
          color={C.red}
          g={g2}
          label="拿走 AI 考试"
          shown={ramp(t, b.yank ?? 9, 0.4)}
          text={<Count p={g2} value={-17} />}
          value={-17}
          x={1580}
        />
      </div>
      <div style={{ opacity: g3 }}>
        <div
          style={{
            background: "#AAB3C0",
            borderRadius: 4,
            height: 8,
            left: 1730,
            position: "absolute",
            top: BASE_Y - 4,
            width: 110,
          }}
        />
        <div
          style={{
            color: C.textOnSky,
            fontSize: 30,
            left: 1655,
            lineHeight: 1.35,
            position: "absolute",
            textAlign: "center",
            top: BASE_Y - 116,
            width: 260,
          }}
        >
          只给提示的
          <br />
          AI 辅导
        </div>
      </div>
    </AbsoluteFill>
  );
}

// 盖章：从大到小砸下来，略歪
function Stamp({ at }: { at: number }) {
  const s = useSpring(at, 11);
  if (s <= 0.001) {
    return null;
  }
  return (
    <div
      style={{
        left: 0,
        opacity: Math.min(1, s * 2),
        position: "absolute",
        right: 0,
        textAlign: "center",
        top: 70,
        transform: `scale(${1.7 - 0.7 * s}) rotate(-3deg)`,
      }}
    >
      <span
        style={{
          border: `6px solid ${C.red}`,
          borderRadius: 18,
          color: C.textOnSky,
          fontFamily: FONT,
          fontSize: 84,
          fontWeight: 700,
          letterSpacing: 4,
          padding: "6px 34px",
        }}
      >
        AI 让你以为学会了
      </span>
    </div>
  );
}

// 结尾两个大词：念到“分不清”时一起出来（灰的），念到哪个词哪个亮起来、旁边亮一颗星：
// 看懂了（半亮）、真会了（全亮）
function Words({ b, t }: { b: Record<string, number>; t: number }) {
  const shown = ramp(t, b.words ?? NEVER, 0.4);
  const word = (at: number, text: string, level: "half" | "full") => {
    const lit = ramp(t, at, 0.35);
    const color = level === "full" ? C.starFull : C.starHalf;
    return (
      <div style={{ alignItems: "center", display: "flex", gap: 22 }}>
        <div style={{ opacity: lit, transform: `scale(${0.4 + 0.6 * lit})` }}>
          <Star level={level} size={level === "full" ? 130 : 110} />
        </div>
        <span
          style={{
            color: lit > 0.5 ? color : "#5A6372",
            fontSize: 132,
            fontWeight: 700,
            transform: `scale(${1 + 0.06 * Math.sin(Math.PI * lit)})`,
          }}
        >
          {text}
        </span>
      </div>
    );
  };
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        flexDirection: "row",
        fontFamily: FONT,
        gap: 140,
        justifyContent: "center",
        opacity: shown,
        transform: `translateY(${(1 - shown) * 30}px)`,
      }}
    >
      {word(b.understood ?? NEVER, "看懂了？", "half")}
      {word(b.mastered ?? NEVER, "真会了？", "full")}
    </AbsoluteFill>
  );
}

export function StoryCard({ beats: b }: { beats: Record<string, number> }) {
  const { t } = useT();
  const chartIn = b.chartIn ?? 3.6;
  const yank = b.yank ?? 8;
  const words = b.words ?? NEVER;
  // 聊天窗口：先在正中，图表出来时缩到左边；被“拿走”时往左飞出画面
  const shrink = ramp(t, chartIn, 0.6);
  const fly = interpolate(t, [yank, yank + 0.45], [0, 1], clamp) ** 2;
  const chatX = 960 - 460 * shrink - 1500 * fly;
  const chatScale = 1 - 0.32 * shrink;
  // 考卷从下面滑进来，停在聊天原来的位置
  const exam = ramp(t, yank + 0.25, 0.5);
  // “然后呢？”：压暗全场
  const what = b.what ?? 7;
  const whatP =
    interpolate(t, [what, what + 0.15], [0, 1], clamp) *
    interpolate(t, [yank - 0.05, yank + 0.25], [1, 0], clamp);
  // 底下一行小字：先是出处；只给提示的 AI 辅导那根柱子出来后换成那组的结果
  const note = t >= (b.bar3 ?? NEVER) ? TUTOR_NOTE : CITE;
  // 结尾只留两个大词：前面的东西都淡掉
  const out = 1 - ramp(t, words, 0.5);
  // −17% 砸下去时画面抖一下
  const hit = b.bar2 ?? 9;
  const shake =
    t > hit && t < hit + 0.35
      ? Math.sin((t - hit) * 90) * 10 * (1 - (t - hit) / 0.35)
      : 0;
  return (
    <AbsoluteFill style={{ transform: `translateY(${shake}px)` }}>
      <AbsoluteFill style={{ opacity: out }}>
        <div
          style={{
            left: chatX,
            position: "absolute",
            top: 470,
            transform: `translate(-50%, -50%) scale(${chatScale}) rotate(${-10 * fly}deg)`,
          }}
        >
          <Chat b={b} />
        </div>
        {exam > 0 ? (
          <div
            style={{
              left: 500,
              opacity: exam,
              position: "absolute",
              top: 500 + (1 - exam) * 500,
              transform: "translate(-50%, -50%) scale(0.82) rotate(-2deg)",
            }}
          >
            <Exam t={t} />
          </div>
        ) : null}
        <Chart b={b} t={t} />
        <div
          style={{
            color: C.textOnSkySoft,
            fontFamily: FONT,
            fontSize: 28,
            left: 0,
            opacity: ramp(t, chartIn, 0.5),
            position: "absolute",
            right: 0,
            textAlign: "center",
            top: 858,
          }}
        >
          {note}
        </div>
        <Stamp at={b.stamp ?? 11} />
      </AbsoluteFill>
      {whatP > 0 ? (
        <AbsoluteFill
          style={{
            alignItems: "center",
            background: `rgba(5,8,14,${0.72 * whatP})`,
            justifyContent: "center",
          }}
        >
          <div
            style={{
              color: C.textOnSky,
              fontFamily: FONT,
              fontSize: 150,
              fontWeight: 700,
              opacity: whatP,
              transform: `scale(${0.9 + 0.1 * whatP})`,
            }}
          >
            然后呢？
          </div>
        </AbsoluteFill>
      ) : null}
      {t >= words ? <Words b={b} t={t} /> : null}
    </AbsoluteFill>
  );
}

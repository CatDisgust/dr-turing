import type { ReactNode } from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { QR, SITE_URL } from "../data/qr";
import type { CardKind } from "../edit";
import { C, FONT } from "../theme";
import { Sky, Star } from "./sky";
import { STORY_TEXT, StoryCard } from "./story";

// 字卡：开场动画（story.tsx）、试点计划、收尾。黑底夜空，和星图一个世界

function useT() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return { fps, frame, t: frame / fps };
}

// 某个时刻淡入并轻轻上浮
function Appear({
  at,
  children,
  rise = 24,
}: {
  at: number;
  children: ReactNode;
  rise?: number;
}) {
  const { t } = useT();
  const p = interpolate(t, [at, at + 0.6], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const e = 1 - (1 - p) ** 3;
  return (
    <div style={{ opacity: e, transform: `translateY(${(1 - e) * rise}px)` }}>
      {children}
    </div>
  );
}

const center = {
  alignItems: "center",
  color: C.textOnSky,
  display: "flex",
  flexDirection: "column",
  fontFamily: FONT,
  justifyContent: "center",
} as const;

function PilotCard({ beats }: { beats: Record<string, number> }) {
  return (
    <AbsoluteFill style={center}>
      <Appear at={beats.title ?? 0.2}>
        <div style={{ fontSize: 72, fontWeight: 700 }}>下一步：小规模试点</div>
      </Appear>
      <div style={{ height: 36 }} />
      <Appear at={beats.metric ?? 0.7}>
        <div style={{ color: C.textOnSkySoft, fontSize: 48 }}>
          检验：按遗忘曲线隔一段时间再测，不看提示还能答对吗
        </div>
      </Appear>
    </AbsoluteFill>
  );
}

// 二维码：白底圆角小方块，留 2 格静区，扫得出来
function QrCode({ size }: { size: number }) {
  const n = QR.length;
  const quiet = 2;
  return (
    <svg
      height={size}
      role="img"
      style={{ background: "#fff", borderRadius: 10 }}
      viewBox={`${-quiet} ${-quiet} ${n + quiet * 2} ${n + quiet * 2}`}
      width={size}
    >
      <title>{SITE_URL}</title>
      <path
        d={QR.flatMap((row, y) =>
          [...row].flatMap((c, x) => (c === "1" ? [`M${x} ${y}h1v1h-1z`] : []))
        ).join("")}
        fill="#0b0f1a"
        shapeRendering="crispEdges"
      />
    </svg>
  );
}

function EndCard({ beats }: { beats: Record<string, number> }) {
  return (
    <AbsoluteFill style={center}>
      <Appear at={beats.line1 ?? 0.2}>
        <div style={{ color: C.textOnSkySoft, fontSize: 64 }}>
          AI 让你以为学会了。
        </div>
      </Appear>
      <div style={{ height: 40 }} />
      <Appear at={beats.line2 ?? 2.2}>
        <div
          style={{
            alignItems: "center",
            display: "flex",
            fontSize: 88,
            fontWeight: 700,
            gap: 24,
          }}
        >
          <Star level="full" size={96} />
          <span>Dr.Turing，让你真的学会。</span>
        </div>
      </Appear>
      <div style={{ bottom: 56, position: "absolute" }}>
        <Appear at={beats.url ?? 4}>
          <div style={{ alignItems: "center", display: "flex", gap: 28 }}>
            <QrCode size={190} />
            <div style={{ color: C.textOnSkySoft, fontSize: 32 }}>
              {SITE_URL.replace("https://", "")}
            </div>
          </div>
        </Appear>
      </div>
      <div
        style={{
          bottom: 28,
          color: C.textOnSkySoft,
          fontSize: 20,
          opacity: 0.7,
          position: "absolute",
          right: 40,
        }}
      >
        AI 配音
      </div>
    </AbsoluteFill>
  );
}

export function Card({
  kind,
  beats = {},
}: {
  kind: CardKind;
  beats?: Record<string, number>;
}) {
  return (
    <AbsoluteFill>
      <Sky drift={6} />
      {kind === "pilot" ? <PilotCard beats={beats} /> : null}
      {kind === "end" ? <EndCard beats={beats} /> : null}
      {kind === "story" ? <StoryCard beats={beats} /> : null}
    </AbsoluteFill>
  );
}

export const CARD_TEXT =
  STORY_TEXT +
  "AI让你以为学会了用练习时拿掉考试近千名高中生对照实验和不的同学比Bastani等PNAS2025少给答案、多反问：能减少伤害但你分不清：看懂了，还是真会了下一步：小规模试点「隔天独立答对率」检验第二天不看提示还能吗表面记忆淡以后（）按遗忘曲线一段时间再测Dr.Turing，让真的学会。dr-turing-81so.vercel.app配音+−%0123456789土耳其数课都没过走";

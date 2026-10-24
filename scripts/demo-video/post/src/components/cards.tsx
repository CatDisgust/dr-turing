import type { ReactNode } from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { QR, SITE_URL } from "../data/qr";
import type { CardKind } from "../edit";
import { C, FONT } from "../theme";
import { Sky, Star } from "./sky";
import { STORY_TEXT, StoryCard } from "./story";

// 字卡：镜头 1 痛点、镜头 2 现有方案缺一步、试点计划、收尾。黑底夜空，和星图一个世界

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

function Pop({ at, children }: { at: number; children: ReactNode }) {
  const { fps, frame } = useT();
  const s = spring({
    config: { damping: 14, mass: 0.6 },
    fps,
    frame: frame - Math.round(at * fps),
  });
  return (
    <div
      style={{
        opacity: Math.min(1, s * 1.5),
        transform: `scale(${0.6 + 0.4 * s})`,
      }}
    >
      {children}
    </div>
  );
}

function CountUp({ at, to, sign }: { at: number; to: number; sign: string }) {
  const { t } = useT();
  const p = interpolate(t, [at, at + 0.9], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const v = Math.round(to * (1 - (1 - p) ** 3));
  return (
    <span>
      {sign}
      {v}%
    </span>
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

// 一个元素在某个时刻轻轻跳一下（配音念到这个数字时）
function Pulse({ at, children }: { at?: number; children: ReactNode }) {
  const { t } = useT();
  const p =
    at === undefined
      ? 0
      : interpolate(t, [at, at + 0.25, at + 0.6], [0, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
  return <div style={{ transform: `scale(${1 + 0.07 * p})` }}>{children}</div>;
}

// 痛点：标题和两个数字一开场就打出来，不等配音念到；念到哪个数字，那个数字跳一下。
// 出处写清楚比的是谁（都和没用过 AI 的同学比），字号够大
function PainCard({ beats }: { beats: Record<string, number> }) {
  const practice = beats.practice ?? 0.7;
  const exam = beats.exam ?? 1.3;
  const stat = (label: string, color: string, node: ReactNode) => (
    <div
      style={{
        alignItems: "center",
        display: "flex",
        flexDirection: "column",
        width: 440,
      }}
    >
      <div style={{ color: C.textOnSkySoft, fontSize: 44 }}>{label}</div>
      <div style={{ color, fontSize: 160, fontWeight: 700, lineHeight: 1.1 }}>
        {node}
      </div>
    </div>
  );
  return (
    <AbsoluteFill style={center}>
      <Appear at={beats.title ?? 0.15}>
        <div style={{ fontSize: 96, fontWeight: 700, letterSpacing: 4 }}>
          AI 让你以为学会了
        </div>
      </Appear>
      <div style={{ display: "flex", gap: 120, marginTop: 80 }}>
        <Pop at={practice}>
          <Pulse at={beats.practiceSaid}>
            {stat(
              "用 AI 练习时",
              C.green,
              <CountUp at={practice} sign="+" to={48} />
            )}
          </Pulse>
        </Pop>
        <Pop at={exam}>
          <Pulse at={beats.examSaid}>
            {stat(
              "拿走 AI 考试",
              C.red,
              <CountUp at={exam} sign="−" to={17} />
            )}
          </Pulse>
        </Pop>
      </div>
      <Appear at={exam + 0.3}>
        <div
          style={{
            color: C.textOnSkySoft,
            fontSize: 36,
            lineHeight: 1.5,
            marginTop: 56,
            textAlign: "center",
          }}
        >
          <div>
            土耳其近千名高中生 · 数学课对照实验 · 都和没用过 AI 的同学比
          </div>
          <div>Bastani 等，PNAS 2025</div>
        </div>
      </Appear>
    </AbsoluteFill>
  );
}

function GapCard({ beats }: { beats: Record<string, number> }) {
  const line2 = beats.line2 ?? 4.2;
  const { t } = useT();
  const dim = interpolate(t, [line2, line2 + 0.6], [1, 0.45], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={center}>
      <div style={{ opacity: dim }}>
        <Appear at={beats.line1 ?? 0.3}>
          <div style={{ color: C.textOnSky, fontSize: 64 }}>
            少给答案、多反问：
            <span style={{ fontWeight: 700 }}>能减少伤害</span>
          </div>
        </Appear>
      </div>
      <div style={{ height: 70 }} />
      <Appear at={line2}>
        <div
          style={{
            alignItems: "center",
            display: "flex",
            fontSize: 72,
            fontWeight: 700,
            gap: 8,
          }}
        >
          <span>但你分不清：</span>
          <Word
            at={beats.understood ?? line2 + 1.2}
            level="half"
            text="看懂了"
          />
          <span>，还是</span>
          <Word at={beats.mastered ?? line2 + 2.4} level="full" text="真会了" />
        </div>
      </Appear>
    </AbsoluteFill>
  );
}

// 词旁边亮起一颗星：看懂了半亮，真会了全亮
function Word({
  at,
  level,
  text,
}: {
  at: number;
  level: "half" | "full";
  text: string;
}) {
  const { t } = useT();
  const p = interpolate(t, [at, at + 0.5], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <span
      style={{
        alignItems: "center",
        display: "inline-flex",
        position: "relative",
      }}
    >
      <span
        style={{
          color: level === "full" ? C.starFull : C.starHalf,
          textShadow:
            level === "full"
              ? `0 0 ${24 * p}px rgba(255,244,224,0.55)`
              : "none",
        }}
      >
        {text}
      </span>
      <span
        style={{
          opacity: p,
          position: "absolute",
          right: -46,
          top: -34,
          transform: `scale(${0.4 + 0.6 * p})`,
        }}
      >
        <Star level={level} size={level === "full" ? 76 : 64} />
      </span>
    </span>
  );
}

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
      {kind === "pain" ? <PainCard beats={beats} /> : null}
      {kind === "gap" ? <GapCard beats={beats} /> : null}
      {kind === "pilot" ? <PilotCard beats={beats} /> : null}
      {kind === "end" ? <EndCard beats={beats} /> : null}
      {kind === "story" ? <StoryCard beats={beats} /> : null}
    </AbsoluteFill>
  );
}

export const CARD_TEXT =
  STORY_TEXT +
  "AI让你以为学会了用练习时拿掉考试近千名高中生对照实验和不的同学比Bastani等PNAS2025少给答案、多反问：能减少伤害但你分不清：看懂了，还是真会了下一步：小规模试点「隔天独立答对率」检验第二天不看提示还能吗表面记忆淡以后（）按遗忘曲线一段时间再测Dr.Turing，让真的学会。dr-turing-81so.vercel.app配音+−%0123456789土耳其数课都没过走";

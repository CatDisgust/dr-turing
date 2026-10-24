import {
  AbsoluteFill,
  random,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { C } from "../theme";

// 字卡背景：和星图抽屉同一片夜空，几百颗暗星缓慢呼吸
const STARS = Array.from({ length: 260 }, (_, i) => ({
  phase: random(`p${i}`) * Math.PI * 2,
  r: 0.6 + random(`r${i}`) ** 3 * 1.8,
  speed: 0.3 + random(`s${i}`) * 0.7,
  x: random(`x${i}`),
  y: random(`y${i}`),
}));

export function Sky({ drift = 0 }: { drift?: number }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  return (
    <AbsoluteFill style={{ background: C.sky }}>
      <svg
        height={height}
        style={{ position: "absolute" }}
        viewBox={`0 0 ${width} ${height}`}
        width={width}
      >
        <title>夜空</title>
        {STARS.map((s) => {
          const twinkle = 0.55 + 0.45 * Math.sin(t * s.speed + s.phase);
          return (
            <circle
              cx={(((s.x * width + t * drift) % width) + width) % width}
              cy={s.y * height}
              fill="#C8D2E6"
              key={`${s.x}-${s.y}`}
              opacity={0.12 + 0.3 * twinkle * (s.r / 2.4)}
              r={s.r}
            />
          );
        })}
      </svg>
    </AbsoluteFill>
  );
}

// 一颗星：half = 看懂了（暗、暖黄），full = 真会了（亮、有光芒）
export function Star({
  size,
  level,
}: {
  size: number;
  level: "half" | "full";
}) {
  const full = level === "full";
  const core = full ? C.starFull : C.starHalf;
  return (
    <svg height={size} viewBox="-50 -50 100 100" width={size}>
      <title>{full ? "全亮" : "半亮"}</title>
      <defs>
        <radialGradient id={`glow-${level}`}>
          <stop offset="0%" stopColor={core} stopOpacity={full ? 0.9 : 0.6} />
          <stop offset="40%" stopColor={core} stopOpacity={full ? 0.3 : 0.12} />
          <stop offset="100%" stopColor={core} stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle fill={`url(#glow-${level})`} r={50} />
      {full ? (
        <g opacity={0.7} stroke={core} strokeLinecap="round" strokeWidth={1.4}>
          <line x1={-44} x2={44} y1={0} y2={0} />
          <line x1={0} x2={0} y1={-44} y2={44} />
        </g>
      ) : null}
      <circle fill={core} opacity={full ? 1 : 0.85} r={full ? 7 : 6} />
    </svg>
  );
}

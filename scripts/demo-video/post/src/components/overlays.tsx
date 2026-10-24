import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { type Badge, type Cue, subtitleText } from "../edit";
import { C, FONT } from "../theme";

// 烧录字幕：思源黑体 52px，白字半透明深底；淡入淡出 0.12 秒
export function Subtitles({ cues }: { cues: Cue[] }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const cue = cues.find((c) => t >= c.start && t < c.end);
  if (!cue) {
    return null;
  }
  const fade = Math.min(
    interpolate(t, [cue.start, cue.start + 0.12], [0, 1], {
      extrapolateRight: "clamp",
    }),
    interpolate(t, [cue.end - 0.12, cue.end], [1, 0], {
      extrapolateLeft: "clamp",
    })
  );
  const top = cue.position === "top";
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        left: 0,
        opacity: fade,
        position: "absolute",
        right: 0,
        ...(top ? { top: 64 } : { bottom: 72 }),
      }}
    >
      <div
        style={{
          background: "rgba(10, 14, 22, 0.62)",
          borderRadius: 10,
          color: "#FFFFFF",
          fontFamily: FONT,
          fontSize: 52,
          fontWeight: 500,
          letterSpacing: 1,
          lineHeight: 1.35,
          padding: "8px 24px",
          textAlign: "center",
          whiteSpace: "pre-line",
        }}
      >
        {subtitleText(cue.text)}
      </div>
    </div>
  );
}

// 角标：“演示账号，学习记录为预置”“模拟第二天（预置数据）”，以及加速时的“已加速 ×N”
export function Badges({ badges, speed }: { badges: Badge[]; speed: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const shown = badges.filter(
    (b) => t >= (b.from ?? 0) && t < (b.to ?? Number.POSITIVE_INFINITY)
  );
  const pill = {
    background: "rgba(37, 46, 60, 0.82)",
    borderRadius: 999,
    color: "#FFFFFF",
    fontFamily: FONT,
    fontSize: 26,
    padding: "6px 18px",
  } as const;
  return (
    <>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          left: 28,
          position: "absolute",
          top: 24,
        }}
      >
        {shown.map((b) => (
          <div key={b.text} style={pill}>
            {b.text}
          </div>
        ))}
      </div>
      {speed > 1 ? (
        <div style={{ ...pill, position: "absolute", right: 28, top: 24 }}>
          已加速 ×{speed >= 2 ? Math.round(speed) : speed.toFixed(1)}
        </div>
      ) : null}
    </>
  );
}

// 光标：macOS 箭头，点击时一圈蓝色波纹
export function CursorArrow({
  x,
  y,
  size,
}: {
  x: number;
  y: number;
  size: number;
}) {
  return (
    <svg
      height={size}
      // 箭头尖在 viewBox 的 (5, 2.5)，对准点击位置
      style={{
        left: x - (size * 5) / 24,
        position: "absolute",
        top: y - (size * 2.5) / 24,
      }}
      viewBox="0 0 24 24"
      width={size}
    >
      <title>光标</title>
      <path
        d="M5 2.5v17.2l4.3-4.1 2.7 6.2 2.6-1.1-2.7-6.1h5.9z"
        fill="#111"
        stroke="#fff"
        strokeLinejoin="round"
        strokeWidth={1.4}
      />
    </svg>
  );
}

export function Ripple({ x, y, p }: { x: number; y: number; p: number }) {
  const r = 14 + 46 * p;
  return (
    <div
      style={{
        border: `4px solid ${C.blueEdge}`,
        borderRadius: "50%",
        height: r * 2,
        left: x - r,
        opacity: (1 - p) * 0.9,
        position: "absolute",
        top: y - r,
        width: r * 2,
      }}
    />
  );
}

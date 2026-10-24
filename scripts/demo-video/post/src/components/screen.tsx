import {
  AbsoluteFill,
  interpolate,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  cameraAt,
  clipAt,
  cursorAt,
  layoutClips,
  project,
  type ScreenShot,
  sourceTime,
  VIEW_H,
  VIEW_W,
} from "../edit";
import { C, FONT } from "../theme";
import { Badges, CursorArrow, Ripple, Subtitles } from "./overlays";
import { Star } from "./sky";

const RIPPLE_SECS = 0.45;

// 一段录屏：按剪辑单取片段（可加速），按镜头键放大平移，画上光标和点击波纹，叠角标和字幕
export function ScreenScene({ shot }: { shot: ScreenShot }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const out = frame / fps;
  const laid = layoutClips(shot.clips);
  const src = sourceTime(laid, out);
  const cam = cameraAt(shot.camera, src);
  const s = (width / VIEW_W) * cam.zoom;
  const v = shot.viewport;

  // 素材像素 → 成片：先换成网页坐标，再按镜头放大
  const k = s / v.scale;
  const tx = width / 2 - cam.x * s - v.x * k;
  const ty = height / 2 - cam.y * s - v.y * k;
  const layer = {
    height: v.height,
    left: 0,
    position: "absolute",
    top: 0,
    transform: `translate(${tx}px, ${ty}px) scale(${k})`,
    transformOrigin: "0 0",
    width: v.width,
  } as const;

  const cursor = cursorAt(shot.cursor, src);
  const cursorOut = cursor ? project(cursor, cam, width, height) : null;
  const ripples = shot.clicks
    .filter((c) => src >= c.t && src < c.t + RIPPLE_SECS)
    .map((c) => ({
      p: (src - c.t) / RIPPLE_SECS,
      ...project(c, cam, width, height),
    }));

  return (
    <AbsoluteFill style={{ background: C.page, overflow: "hidden" }}>
      {shot.footage ? (
        laid.map((clip) => (
          <Sequence
            durationInFrames={Math.max(
              1,
              Math.round((clip.outEnd - clip.outStart) * fps)
            )}
            from={Math.round(clip.outStart * fps)}
            key={`${clip.from}-${clip.to}`}
            layout="none"
          >
            <OffthreadVideo
              muted
              playbackRate={clip.rate}
              src={staticFile(shot.footage as string)}
              style={layer}
              trimBefore={Math.round(clip.from * fps)}
            />
          </Sequence>
        ))
      ) : (
        <div style={layer}>
          <Placeholder shot={shot} />
        </div>
      )}
      {ripples.map((r) => (
        <Ripple key={`${r.x}-${r.y}`} p={r.p} x={r.x} y={r.y} />
      ))}
      {cursorOut ? (
        <CursorArrow
          size={34 * Math.sqrt(cam.zoom)}
          x={cursorOut.x}
          y={cursorOut.y}
        />
      ) : null}
      <Badges badges={shot.badges ?? []} speed={clipAt(laid, out)?.rate ?? 1} />
      <Subtitles cues={shot.cues} />
      {shot.intro ? <TitleIntro t={out} /> : null}
    </AbsoluteFill>
  );
}

// 计时样带用的占位画面：画一个简化的对话页，标出这一镜要拍什么
function Placeholder({ shot }: { shot: ScreenShot }) {
  return (
    <div
      style={{
        background: C.page,
        color: C.ink,
        fontFamily: FONT,
        height: VIEW_H,
        position: "relative",
        width: VIEW_W,
      }}
    >
      <div
        style={{
          borderBottom: `2px solid ${C.border}`,
          fontSize: 16,
          fontWeight: 700,
          height: 52,
          lineHeight: "52px",
          paddingLeft: 24,
        }}
      >
        Dr.Turing · {shot.title}
      </div>
      <div
        style={{
          background: C.sky,
          bottom: 0,
          position: "absolute",
          right: 0,
          top: 52,
          width: 380,
        }}
      />
      <div style={{ left: 120, position: "absolute", top: 150, width: 640 }}>
        <div style={{ color: C.inkSoft, fontSize: 18, marginBottom: 14 }}>
          占位画面（正式录制后替换）
        </div>
        <div style={{ fontSize: 24, lineHeight: 1.6 }}>{shot.placeholder}</div>
      </div>
      <div
        style={{
          border: `2px solid ${C.border}`,
          borderRadius: 16,
          bottom: 24,
          height: 56,
          left: 120,
          position: "absolute",
          width: 640,
        }}
      />
    </div>
  );
}

function TitleIntro({ t }: { t: number }) {
  const opacity = interpolate(t, [0.9, 1.7], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  if (opacity <= 0) {
    return null;
  }
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        background: C.sky,
        color: C.textOnSky,
        display: "flex",
        flexDirection: "row",
        fontFamily: FONT,
        fontSize: 110,
        fontWeight: 700,
        gap: 28,
        justifyContent: "center",
        opacity,
      }}
    >
      <Star level="full" size={120} />
      Dr.Turing
    </AbsoluteFill>
  );
}

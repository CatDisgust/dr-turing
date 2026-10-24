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
  cursorAt,
  layoutClips,
  project,
  type ScreenShot,
  sourceTime,
  speedAt,
  VIEW_H,
  VIEW_W,
  windowRect,
} from "../edit";
import { C, FONT } from "../theme";
import {
  BADGE_H,
  Badges,
  CursorArrow,
  Ripple,
  SUBTITLE_H,
  Subtitles,
} from "./overlays";
import { Sky, Star } from "./sky";

const RIPPLE_SECS = 0.45;

// 一段录屏：按剪辑单取片段（可加速），按镜头键放大平移，画上光标和点击波纹；
// 网页装在夜空上的一个窗口里，角标在窗口上方、字幕在窗口下方，不挡网页
export function ScreenScene({ shot }: { shot: ScreenShot }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const out = frame / fps;
  const win = windowRect(width, height);
  const laid = layoutClips(shot.clips);
  const src = sourceTime(laid, out);
  const cam = cameraAt(shot.camera, src);
  const s = (win.w / VIEW_W) * cam.zoom;
  const v = shot.viewport;

  // 素材像素 → 窗口：先换成网页坐标，再按镜头放大
  const k = s / v.scale;
  const tx = win.w / 2 - cam.x * s - v.x * k;
  const ty = win.h / 2 - cam.y * s - v.y * k;
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
  const cursorOut = cursor ? project(cursor, cam, win.w, win.h) : null;
  const ripples = shot.clicks
    .filter((c) => src >= c.t && src < c.t + RIPPLE_SECS)
    .map((c) => ({
      p: (src - c.t) / RIPPLE_SECS,
      ...project(c, cam, win.w, win.h),
    }));
  const below = height - win.y - win.h;

  return (
    <AbsoluteFill style={{ background: C.sky, overflow: "hidden" }}>
      <Sky />
      <div
        style={{
          background: C.page,
          borderRadius: 16,
          // 右边是黑底的星图面板，和夜空分不开：描一圈亮一点的边，外面再加一圈很淡的光
          boxShadow:
            "0 0 0 1px rgba(255, 255, 255, 0.2), 0 0 0 7px rgba(132, 216, 255, 0.05), 0 28px 90px rgba(0, 0, 0, 0.6)",
          height: win.h,
          left: win.x,
          overflow: "hidden",
          position: "absolute",
          top: win.y,
          width: win.w,
        }}
      >
        {shot.footage ? (
          laid.map((clip, i) => (
            <Sequence
              // 起止帧都从成片时间取整再相减：分别取整会在相邻两段之间漏出一帧白底。
              // 最后一段一直放到镜头结束，镜头时长取整多出的那一帧也有画面
              durationInFrames={
                i === laid.length - 1
                  ? Number.POSITIVE_INFINITY
                  : Math.max(
                      1,
                      Math.round(clip.outEnd * fps) -
                        Math.round(clip.outStart * fps)
                    )
              }
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
            size={30 * Math.sqrt(cam.zoom)}
            x={cursorOut.x}
            y={cursorOut.y}
          />
        ) : null}
      </div>
      <Badges
        badges={shot.badges ?? []}
        right={width - win.x - win.w}
        speed={speedAt(laid, out)}
        top={Math.round((win.y - BADGE_H) / 2)}
      />
      <Subtitles
        bottom={Math.round((below - SUBTITLE_H) / 2)}
        cues={shot.cues}
      />
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

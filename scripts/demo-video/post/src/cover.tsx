import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import { SubtitlesOn } from "./components/overlays";
import { ScreenScene } from "./components/screen";
import { Sky, Star } from "./components/sky";
import {
  cameraAt,
  cameraKeysOut,
  type Edit,
  layoutClips,
  type ScreenShot,
  VIEW_W,
} from "./edit";
import { C, FONT, useFonts } from "./theme";

// 封面：左边片名，右边缩小的产品画面（「死锁」全亮后 AFTER 秒，星正亮着）。出图：npx remotion still src/index.ts Cover out/cover.png
const LINE1 = "AI 让你以为学会了";
const LINE2 = "让你真的学会";
const AFTER = 1.2;
const SCALE = 0.56;
const SHIFT = -60;
// 网页右边「我的星图」抽屉宽 440：镜头放大到只看得见抽屉（左边不露半截对话），不画光标
const DRAWER_W = 440;

// 没有全亮那一声（比如计时样带）就取最后一个录屏镜头的中间
function pickFrame(edit: Edit): { shot: ScreenShot; t: number } | null {
  const screens = edit.shots.filter(
    (s): s is ScreenShot => s.kind === "screen"
  );
  for (const shot of screens) {
    const full = shot.sfx?.find((x) => x.file.endsWith("chime-full.wav"));
    if (full) {
      return { shot, t: full.t + AFTER };
    }
  }
  const last = screens.at(-1);
  return last ? { shot: last, t: (last.cues.at(-1)?.end ?? 0) / 2 } : null;
}

function starMapOnly(shot: ScreenShot, t: number): ScreenShot {
  const cam = cameraAt(cameraKeysOut(shot.camera, layoutClips(shot.clips)), t);
  const zoom = Math.max(cam.zoom, (VIEW_W / DRAWER_W) * 1.03);
  return {
    ...shot,
    camera: [{ dur: 0, t: -1, x: VIEW_W, y: cam.y, zoom }],
    clicks: [],
    cursor: [],
  };
}

export function Cover({ edit }: { edit: Edit }) {
  useFonts(`${LINE1}Dr.Turing${LINE2}`);
  const { fps } = useVideoConfig();
  const pick = pickFrame(edit);
  return (
    <SubtitlesOn.Provider value={false}>
      <AbsoluteFill style={{ background: C.sky }}>
        <Sky />
        {pick ? (
          <AbsoluteFill
            style={{
              transform: `translateX(${SHIFT}px) scale(${SCALE})`,
              transformOrigin: "right center",
            }}
          >
            <Sequence from={-Math.round(pick.t * fps)}>
              <ScreenScene shot={starMapOnly(pick.shot, pick.t)} />
            </Sequence>
          </AbsoluteFill>
        ) : null}
        <AbsoluteFill
          style={{
            color: C.textOnSky,
            fontFamily: FONT,
            justifyContent: "center",
            paddingLeft: 120,
          }}
        >
          <div style={{ color: C.textOnSkySoft, fontSize: 48 }}>{LINE1}</div>
          <div
            style={{
              alignItems: "center",
              display: "flex",
              fontSize: 96,
              fontWeight: 700,
              gap: 20,
              marginTop: 36,
            }}
          >
            <Star level="full" size={92} />
            <span>Dr.Turing</span>
          </div>
          <div style={{ fontSize: 96, fontWeight: 700, marginTop: 8 }}>
            {LINE2}
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    </SubtitlesOn.Provider>
  );
}

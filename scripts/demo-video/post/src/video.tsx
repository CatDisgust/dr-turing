import { useCallback } from "react";
import {
  AbsoluteFill,
  Audio,
  interpolate,
  Sequence,
  staticFile,
  useVideoConfig,
} from "remotion";
import { CARD_TEXT, Card } from "./components/cards";
import { Subtitles, SubtitlesOn } from "./components/overlays";
import { ScreenScene } from "./components/screen";
import {
  type Edit,
  type Music,
  type Shot,
  shotDuration,
  shotVoices,
} from "./edit";
import { useFonts } from "./theme";

export function layoutShots(edit: Edit) {
  let t = 0;
  return edit.shots.map((shot) => {
    const start = t;
    t += shotDuration(shot);
    return { end: t, shot, start };
  });
}

export function editDuration(edit: Edit) {
  return layoutShots(edit).at(-1)?.end ?? 0;
}

// 说话的时间段（成片秒数），音乐在这些时间里压低
function speechSpans(edit: Edit) {
  return layoutShots(edit).flatMap(({ shot, start }) =>
    shotVoices(shot).flatMap((n) => {
      const len = edit.narrationDurations?.[n.file];
      return len ? [[start + n.start, start + n.start + len] as const] : [];
    })
  );
}

// 音乐停掉的时间段（成片秒数）
function muteSpans(edit: Edit) {
  return layoutShots(edit).flatMap(({ shot, start }) =>
    shot.kind === "card"
      ? (shot.mute ?? []).map(([a, b]) => [start + a, start + b] as const)
      : []
  );
}

const RAMP = 0.35;

function allText(edit: Edit) {
  return (
    CARD_TEXT +
    edit.shots
      .flatMap((s) => [
        s.title,
        ...s.cues.map((c) => c.text),
        ...(s.kind === "screen"
          ? [s.placeholder ?? "", ...(s.badges ?? []).map((b) => b.text)]
          : []),
      ])
      .join("") +
    "已加速×占位画面（正式录制后替换）"
  );
}

function ShotView({ shot }: { shot: Shot }) {
  if (shot.kind === "screen") {
    return <ScreenScene shot={shot} />;
  }
  return (
    <AbsoluteFill>
      <Card beats={shot.beats} kind={shot.card} />
      <Subtitles cues={shot.cues} />
    </AbsoluteFill>
  );
}

export function Video({
  edit,
  subtitles = true,
}: {
  edit: Edit;
  subtitles?: boolean;
}) {
  const { fps } = useVideoConfig();
  useFonts(allText(edit));
  const shots = layoutShots(edit);
  const spans = speechSpans(edit);
  const mutes = muteSpans(edit);
  const f = (sec: number) => Math.round(sec * fps);
  const { music } = edit;

  return (
    <SubtitlesOn.Provider value={subtitles}>
      <AbsoluteFill style={{ background: "#000" }}>
        {shots.map(({ shot, start, end }) => (
          <Sequence
            durationInFrames={f(end) - f(start)}
            from={f(start)}
            key={shot.id}
            name={shot.title}
          >
            <ShotView shot={shot} />
            {shotVoices(shot).map((n) => (
              <Sequence from={f(n.start)} key={n.file} name="配音">
                <Audio src={staticFile(n.file)} />
              </Sequence>
            ))}
            {(shot.sfx ?? []).map((s) => (
              <Sequence from={f(s.t)} key={`${s.file}-${s.t}`} name="音效">
                <Audio src={staticFile(s.file)} volume={s.volume ?? 0.5} />
              </Sequence>
            ))}
          </Sequence>
        ))}
        {music ? (
          <MusicTrack
            end={shots.at(-1)?.end ?? 0}
            music={music}
            mutes={mutes}
            spans={spans}
          />
        ) : null}
      </AbsoluteFill>
    </SubtitlesOn.Provider>
  );
}

// 音乐：说话时压低 duckDb 分贝，每个说话段前后各留 RAMP 秒平滑压低、回升；成片最后 FADE_OUT 秒淡出。
// 抬起层从 lift.at 前 LIFT_IN[0] 秒开始、用 LIFT_IN[1] 秒淡入
const FADE_OUT = 3;
const LIFT_IN = [0.3, 2.5] as const;

// 停音乐：0.08 秒内收掉，停完 0.4 秒回来
const MUTE_RAMP = [0.08, 0.4] as const;

function MusicTrack({
  end,
  music,
  mutes,
  spans,
}: {
  end: number;
  music: Music;
  mutes: (readonly [number, number])[];
  spans: (readonly [number, number])[];
}) {
  const { fps } = useVideoConfig();
  const duck = 10 ** (-music.duckDb / 20);
  const volume = useCallback(
    (frame: number) => {
      const t = frame / fps;
      const speaking = Math.max(
        0,
        ...spans.map(([a, b]) =>
          interpolate(t, [a - RAMP, a, b, b + RAMP], [0, 1, 1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
        )
      );
      const fade = interpolate(t, [end - FADE_OUT, end - 0.1], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      const muted = Math.max(
        0,
        ...mutes.map(([a, b]) =>
          interpolate(
            t,
            [a - MUTE_RAMP[0], a, b, b + MUTE_RAMP[1]],
            [0, 1, 1, 0],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          )
        )
      );
      return (
        music.volume * (1 - speaking + speaking * duck) * fade * (1 - muted)
      );
    },
    [duck, end, fps, music.volume, mutes, spans]
  );
  const at = music.lift?.at ?? end;
  const liftVolume = useCallback(
    (frame: number) =>
      volume(frame) *
      interpolate(
        frame / fps,
        [at - LIFT_IN[0], at - LIFT_IN[0] + LIFT_IN[1]],
        [0, 1],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
      ),
    [at, fps, volume]
  );
  return (
    <>
      <Audio loop src={staticFile(music.file)} volume={volume} />
      {music.lift ? (
        <Audio loop src={staticFile(music.lift.file)} volume={liftVolume} />
      ) : null}
    </>
  );
}

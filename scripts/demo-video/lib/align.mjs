// 日志时间（毫秒时间戳）→ 素材时间（秒）。开录后页面闪白 3 帧，日志里记下闪白的时间戳；
// 在素材里找到那一帧，两边一对就知道偏移。开头、结尾各闪一次，两点连线还能顺手校正时钟漂移。
// 纯函数，test/align.test.mjs 有单测；align.mjs 用 ffmpeg 量每帧亮度后调用这里

// 解析 ffmpeg `signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-` 的输出
export function parseSignalstats(text) {
  const samples = [];
  let frame = null;
  let t = null;
  for (const line of text.split(/\r?\n/)) {
    const head = line.match(
      /frame:\s*(\d+)\s+pts:\s*\S+\s+pts_time:\s*([\d.]+)/
    );
    if (head) {
      frame = Number(head[1]);
      t = Number(head[2]);
      continue;
    }
    const value = line.match(/lavfi\.signalstats\.YAVG=([\d.]+)/);
    if (value && frame !== null) {
      samples.push({ frame, t, y: Number(value[1]) });
      frame = null;
    }
  }
  return samples;
}

function median(values) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// 找所有闪白：亮度比前面一段的中位数突然高出 minJump，并且 maxFrames 帧以内落回去
export function findFlashes(
  samples,
  { minJump = 50, maxFrames = 10, baseline = 20 } = {}
) {
  const flashes = [];
  let i = 1;
  while (i < samples.length) {
    const base = median(
      samples.slice(Math.max(0, i - baseline), i).map((s) => s.y)
    );
    if (samples[i].y - base < minJump) {
      i += 1;
      continue;
    }
    let j = i + 1;
    let peak = samples[i].y;
    while (j < samples.length && samples[j].y >= base + minJump / 2) {
      peak = Math.max(peak, samples[j].y);
      j += 1;
    }
    if (j < samples.length && j - i <= maxFrames) {
      flashes.push({
        base,
        frame: samples[i].frame,
        frames: j - i,
        peak,
        t: samples[i].t,
      });
    }
    i = j + 1;
  }
  return flashes;
}

export function findFlash(samples, options) {
  return findFlashes(samples, options)[0] ?? null;
}

// 一个或两个对齐点 → 时钟：epoch 毫秒 → 素材秒。两个点时按两点连线（含漂移），一个点时速率为 1
export function makeClock(anchors) {
  if (!anchors?.length) {
    throw new Error("至少要一个对齐点（闪白）");
  }
  const [a, b] = anchors;
  const rate =
    b && b.epochMs !== a.epochMs
      ? (b.videoSec - a.videoSec) / ((b.epochMs - a.epochMs) / 1000)
      : 1;
  return (epochMs) => a.videoSec + (rate * (epochMs - a.epochMs)) / 1000;
}

export function alignEvents(events, clock) {
  return events.map((e) => ({ ...e, v: Math.round(clock(e.t) * 1000) / 1000 }));
}

// 给 Remotion 剪辑单用的光标关键帧和点击（素材秒、CSS 像素），光标点按 minGapMs 抽稀
export function editHints(events, clock, { minGapMs = 33 } = {}) {
  const cursor = [];
  const clicks = [];
  const marks = [];
  let lastMove = Number.NEGATIVE_INFINITY;
  for (const e of events) {
    if (e.type === "pointermove" && e.t - lastMove >= minGapMs) {
      cursor.push({ t: round3(clock(e.t)), x: e.x, y: e.y });
      lastMove = e.t;
    } else if (e.type === "pointerdown") {
      cursor.push({ t: round3(clock(e.t)), x: e.x, y: e.y });
      clicks.push({ t: round3(clock(e.t)), testid: e.testid, x: e.x, y: e.y });
    } else if (e.type === "mark") {
      marks.push({
        name: e.name,
        t: round3(clock(e.t)),
        ...(e.label ? { label: e.label } : {}),
        ...(typeof e.ms === "number" ? { ms: e.ms } : {}),
      });
    }
  }
  return { clicks, cursor, marks };
}

const round3 = (x) => Math.round(x * 1000) / 1000;

// 测帧率那段动画在素材里的时段（两头各让 0.15 秒，避开盖层出现和消失的那一帧）；没测就返回 null
export function probeWindow(events, clock) {
  const e = events.find((x) => x.type === "probe");
  if (!e) {
    return null;
  }
  const from = clock(e.t) + 0.15;
  const to = clock(e.tEnd) - 0.15;
  return to > from
    ? {
        from: round3(from),
        pageFps: Math.round((e.frames / (e.tEnd - e.t)) * 1000),
        to: round3(to),
      }
    : null;
}

// 数 ffmpeg showinfo 打出来的帧（每帧一行 “n:  12 pts:…”）
export function countShowinfo(text) {
  return text
    .split(/\r?\n/)
    .filter((l) => /Parsed_showinfo.*\bn:\s*\d+/.test(l)).length;
}

// 把一条录制的日志对到素材时间上：node align.mjs out/<take>
// 用 ffmpeg 量开头、结尾各 40 秒每帧的亮度（只看右边星图那一条，深色底上闪白最明显），找到两次闪白，
// 和 log.json 里记的闪白时间一对，写 out/<take>/aligned.json：光标关键帧、点击、镜头标记、空白帧（素材秒）。
// 需要 ffmpeg / ffprobe（brew install ffmpeg）

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  blankSpans,
  countShowinfo,
  editHints,
  findFlashes,
  makeClock,
  parseSignalstats,
  probeWindow,
} from "./lib/align.mjs";

const WINDOW_SEC = 40;
const REGION = "crop=iw*0.3:ih:iw*0.7:0";

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(
      `${command} 跑不起来：${result.error.message}（装了吗？brew install ffmpeg）`
    );
  }
  if (result.status !== 0) {
    throw new Error(`${command} 失败：${result.stderr.slice(-500)}`);
  }
  return result.stdout;
}

// 从素材第 from 秒起量 WINDOW_SEC 秒的每帧亮度，时间换回整条素材的秒数。
// 不用 -copyts：带着它时输出的 -t 按原时间戳算，从中段起量会一帧都不出（2026-10-24 结尾闪白就是这样漏掉的）
function lumas(video, from = 0) {
  const args = ["-hide_banner", "-nostats"];
  if (from > 0) {
    args.push("-ss", String(from));
  }
  args.push(
    "-i",
    video,
    "-t",
    String(WINDOW_SEC),
    "-an",
    "-vf",
    `${REGION},signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`,
    "-f",
    "null",
    "-"
  );
  return parseSignalstats(run("ffmpeg", args)).map((s) => ({
    ...s,
    t: s.t + from,
  }));
}

// 整条素材里的空白帧（Chrome 重载页面、录制中截图时会把窗口画白几帧），剪辑单据此剪掉。
// 四边各让 5%（窗口描边不算）；最近邻缩小不把字糊浅，量每帧最暗的像素
function blanks(video) {
  const out = run("ffmpeg", [
    "-hide_banner",
    "-nostats",
    "-i",
    video,
    "-an",
    "-vf",
    "crop=iw*0.9:ih*0.9:iw*0.05:ih*0.05,scale=640:-2:flags=neighbor,signalstats,metadata=print:key=lavfi.signalstats.YMIN:file=-",
    "-f",
    "null",
    "-",
  ]);
  return blankSpans(parseSignalstats(out, "YMIN"));
}

// 录屏中的截图只记了时间（director.screenshot 的 still），从素材里取那一帧，按网页 CSS 大小存
function stills(video, events, clock) {
  const shots = events.filter(
    (e) => e.type === "mark" && e.name === "screenshot" && e.still && e.path
  );
  for (const e of shots) {
    run("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      String(Math.max(0, clock(e.t))),
      "-i",
      video,
      "-frames:v",
      "1",
      "-vf",
      "scale=1280:-2",
      e.path,
    ]);
  }
  return shots.length;
}

// 测帧率那段里不重复的帧数 ÷ 时长 = OBS 实际录到的帧率（制作方案要求超过 50）
function uniqueFps(video, window) {
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostats",
      "-ss",
      String(window.from),
      "-t",
      String(window.to - window.from),
      "-i",
      video,
      "-an",
      "-vf",
      "mpdecimate,showinfo",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }
  );
  const frames = countShowinfo(result.stderr ?? "");
  return Math.round((frames / (window.to - window.from)) * 10) / 10;
}

function main() {
  const dir = resolve(process.argv[2] ?? "");
  if (!process.argv[2]) {
    console.log("用法：node align.mjs out/<take>");
    process.exit(1);
  }
  const log = JSON.parse(readFileSync(join(dir, "log.json"), "utf8"));
  const file = readdirSync(dir).find((f) => /^screen\.(mov|mp4|mkv)$/i.test(f));
  if (!file) {
    throw new Error(`${dir} 里没有 screen.mov / screen.mp4 / screen.mkv`);
  }
  const video = join(dir, file);
  const duration = Number(
    run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      video,
    ]).trim()
  );
  const logged = log.events
    .filter((e) => e.type === "flash")
    .toSorted((a, b) => a.t - b.t);
  if (logged.length === 0) {
    throw new Error("log.json 里没有闪白记录");
  }
  const [startFlash] = findFlashes(lumas(video));
  if (!startFlash) {
    throw new Error("素材开头 40 秒里没找到闪白");
  }
  const anchors = [{ epochMs: logged[0].t, videoSec: startFlash.t }];
  if (logged.length > 1 && duration > WINDOW_SEC * 2) {
    const endFlash = findFlashes(lumas(video, duration - WINDOW_SEC)).at(-1);
    if (endFlash) {
      anchors.push({ epochMs: logged.at(-1).t, videoSec: endFlash.t });
    } else {
      console.log("注意：素材结尾没找到闪白，只用开头一个点对齐（不校正漂移）");
    }
  }
  const clock = makeClock(anchors);
  const rate =
    anchors.length > 1
      ? (anchors[1].videoSec - anchors[0].videoSec) /
        ((anchors[1].epochMs - anchors[0].epochMs) / 1000)
      : 1;
  const hints = editHints(log.events, clock);
  const ui = log.events
    .filter((e) => e.type === "ui" || e.type === "stream" || e.type === "app")
    .map((e) => ({ ...e, v: Math.round(clock(e.t) * 1000) / 1000 }));
  const blank = blanks(video);
  console.log(
    blank.length > 0
      ? `空白帧 ${blank.length} 段（共 ${blank.reduce((n, b) => n + b.frames, 0)} 帧）：${blank.map((b) => `${b.from.toFixed(2)}s×${b.frames}`).join("、")}，剪辑单会剪掉`
      : "没有空白帧"
  );
  const still = stills(video, log.events, clock);
  if (still > 0) {
    console.log(`从素材里取了 ${still} 张截图`);
  }
  const probe = probeWindow(log.events, clock);
  if (probe) {
    probe.uniqueFps = uniqueFps(video, probe);
    console.log(
      `测帧率：网页每秒画 ${probe.pageFps} 帧，素材里每秒 ${probe.uniqueFps} 帧不重复${probe.uniqueFps >= 50 ? "（达标）" : "（没到 50，录制设置或电脑负载要查）"}`
    );
  }
  writeFileSync(
    join(dir, "aligned.json"),
    `${JSON.stringify({ anchors, blanks: blank, duration, probe, rate, video: file, viewport: log.footageViewport, ...hints, ui }, null, 1)}\n`
  );
  console.log(
    `对齐好了：开头闪白在素材 ${anchors[0].videoSec.toFixed(3)}s${anchors[1] ? `，结尾 ${anchors[1].videoSec.toFixed(3)}s，时钟比 ${rate.toFixed(6)}` : ""}；写入 ${join(dir, "aligned.json")}`
  );
}

main();

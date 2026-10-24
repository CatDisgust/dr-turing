// 把一条录制的日志对到素材时间上：node align.mjs out/<take>
// 用 ffmpeg 量开头、结尾各 40 秒每帧的亮度（只看右边星图那一条，深色底上闪白最明显），找到两次闪白，
// 和 log.json 里记的闪白时间一对，写 out/<take>/aligned.json：光标关键帧、点击、镜头标记（素材秒）。
// 需要 ffmpeg / ffprobe（brew install ffmpeg）

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  editHints,
  findFlashes,
  makeClock,
  parseSignalstats,
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

function lumas(video, seek) {
  const args = [
    "-hide_banner",
    "-nostats",
    "-copyts",
    ...seek,
    "-i",
    video,
    "-t",
    String(WINDOW_SEC),
  ];
  args.push(
    "-an",
    "-vf",
    `${REGION},signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`,
    "-f",
    "null",
    "-"
  );
  return parseSignalstats(run("ffmpeg", args));
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
  const [startFlash] = findFlashes(lumas(video, []));
  if (!startFlash) {
    throw new Error("素材开头 40 秒里没找到闪白");
  }
  const anchors = [{ epochMs: logged[0].t, videoSec: startFlash.t }];
  if (logged.length > 1 && duration > WINDOW_SEC * 2) {
    const endFlash = findFlashes(
      lumas(video, ["-ss", String(duration - WINDOW_SEC)])
    ).at(-1);
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
  writeFileSync(
    join(dir, "aligned.json"),
    `${JSON.stringify({ anchors, duration, rate, video: file, viewport: log.footageViewport, ...hints, ui }, null, 1)}\n`
  );
  console.log(
    `对齐好了：开头闪白在素材 ${anchors[0].videoSec.toFixed(3)}s${anchors[1] ? `，结尾 ${anchors[1].videoSec.toFixed(3)}s，时钟比 ${rate.toFixed(6)}` : ""}；写入 ${join(dir, "aligned.json")}`
  );
}

main();

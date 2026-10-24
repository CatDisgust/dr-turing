// 临时配音：用 Mac 自带的中文语音把讲稿念出来，计时样带和粗剪先用它对节奏（分镜文档原定“配音先用 Mac 自带中文语音合成”）。
// 正式配音换成 MiniMax 或你自己念时，同样把每段放到 public/voice/<镜头>.wav 再跑一遍量时长（--measure-only）。
//   node scripts/temp-voice.mjs [--voice Tingting] [--rate 200] [--measure-only]
// 写 public/voice/s1.wav…s8.wav 和 src/data/voice.json（每段时长）。需要 macOS 的 say 和 ffmpeg

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SCRIPT } from "../src/data/script.ts";
import { countChars } from "../src/timing.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const measureOnly = args.includes("--measure-only");

function run(command, list) {
  const r = spawnSync(command, list, { encoding: "utf8" });
  if (r.error || r.status !== 0) {
    throw new Error(
      `${command} 失败：${r.error?.message ?? r.stderr.slice(-400)}`
    );
  }
  return r.stdout;
}

// 念的字和字幕的字不完全一样：品牌名念英文，百分数念中文
function spoken(text) {
  return text
    .replaceAll("Dr.Turing", "Doctor Turing")
    .replace(/(\d+)%/g, (_, n) => `百分之${n}`);
}

// 挑一个普通话声音：先按这个顺序找，都没有就用列表里第一个 zh_CN
const PREFERRED = ["Tingting", "Lili", "Yu-shu", "Li-mu", "Meijia"];

function pickVoice() {
  const wanted = flag("--voice");
  if (wanted) {
    return wanted;
  }
  const list = run("say", ["-v", "?"])
    .split("\n")
    .map((line) => line.match(/^(.+?)\s{2,}(zh_CN)\b/))
    .filter(Boolean)
    .map((m) => m[1].trim());
  if (list.length === 0) {
    throw new Error(
      "这台 Mac 上没有普通话声音：系统设置 → 辅助功能 → 朗读内容 → 系统声音 → 管理声音，装一个“婷婷”"
    );
  }
  return (
    PREFERRED.map((p) => list.find((v) => v.startsWith(p))).find(Boolean) ??
    list[0]
  );
}

const duration = (file) =>
  Number(
    run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      file,
    ]).trim()
  );

// 去掉头尾的静音，响度统一到 -16 LUFS（混音时再整体调到 -14）
const CLEAN = [
  "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05",
  "areverse",
  "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05",
  "areverse",
  "loudnorm=I=-16:TP=-1.5:LRA=11",
].join(",");

const dir = join(root, "public/voice");
mkdirSync(dir, { recursive: true });
const voiceName = measureOnly ? (flag("--voice") ?? "自备") : pickVoice();
const rate = flag("--rate");
const files = {};
for (const s of SCRIPT) {
  const wav = join(dir, `${s.id}.wav`);
  if (!measureOnly) {
    const aiff = join(dir, `${s.id}.aiff`);
    run("say", [
      "-v",
      voiceName,
      ...(rate ? ["-r", rate] : []),
      "-o",
      aiff,
      spoken(s.narration),
    ]);
    run("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      aiff,
      "-af",
      CLEAN,
      "-ar",
      "48000",
      "-ac",
      "1",
      wav,
    ]);
  }
  if (!existsSync(wav)) {
    console.log(`${s.id}：没有 ${wav}，跳过`);
    continue;
  }
  const secs = Math.round(duration(wav) * 100) / 100;
  files[s.id] = { duration: secs, file: `voice/${s.id}.wav` };
  const cps = countChars(s.narration) / secs;
  console.log(
    `${s.id} ${s.title}：${secs.toFixed(1)} 秒，每秒 ${cps.toFixed(1)} 字（分镜 ${s.slot} 秒）`
  );
}
writeFileSync(
  join(root, "src/data/voice.json"),
  `${JSON.stringify({ files, voice: voiceName }, null, 1)}\n`
);
console.log(`声音 ${voiceName}；写入 src/data/voice.json`);

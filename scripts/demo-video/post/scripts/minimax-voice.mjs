// 正式配音：用 MiniMax 语音合成把讲稿念出来，写 public/voice/<镜头>.wav，再量时长（同 temp-voice --measure-only）。
// 密钥只从环境变量 MINIMAX_API_KEY 或 post/.env.local 读，不打印、不写进任何文件。
//   node scripts/minimax-voice.mjs --list                    列出账号能用的中文系统音色
//   node scripts/minimax-voice.mjs --samples                 男声、女声各两种念同一段，存到 out/voice-samples/，挑一个
//   node scripts/minimax-voice.mjs --voice <voice_id> [--speed 1]   八段全用这个声音
// 国际站和国内站的密钥不通用：按 MINIMAX_HOST、api.minimax.io、api.minimax.cn、api.minimaxi.com 的顺序试，鉴权不过就换下一个

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SCRIPT } from "../src/data/script.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const MODELS = ["speech-2.8-hd", "speech-2.6-hd", "speech-02-hd"];
// 样音候选：账号里有哪个用哪个，男女各取前两个
const MALE = [
  "Chinese (Mandarin)_Reliable_Executive",
  "Chinese (Mandarin)_Male_Announcer",
  "presenter_male",
  "Chinese (Mandarin)_Gentleman",
  "male-qn-jingying",
];
const FEMALE = [
  "Chinese (Mandarin)_News_Anchor",
  "presenter_female",
  "Chinese (Mandarin)_Wise_Women",
  "female-chengshu",
  "Chinese (Mandarin)_Lyrical_Voice",
];

function apiKey() {
  if (process.env.MINIMAX_API_KEY) {
    return process.env.MINIMAX_API_KEY.trim();
  }
  const file = join(root, ".env.local");
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*MINIMAX_API_KEY\s*=\s*(.*)\s*$/);
      if (m) {
        return m[1].replace(/^["']|["']$/g, "").trim();
      }
    }
  }
  throw new Error(
    "没有 MiniMax 密钥：在终端里运行制作说明里的那条 read -s 命令，把密钥存进 post/.env.local"
  );
}

let KEY = null;
const HOSTS = [
  process.env.MINIMAX_HOST,
  "api.minimax.io",
  "api.minimax.cn",
  "api.minimaxi.com",
].filter(Boolean);
let host = null;

async function call(path, body) {
  const tried = host ? [host] : HOSTS;
  let last = null;
  for (const h of tried) {
    // biome-ignore lint/performance/noAwaitInLoops: 一个站一个站试，前一个鉴权不过才试下一个
    const res = await fetch(`https://${h}${path}`, {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    }).catch((error) => ({ error }));
    if (res.error) {
      last = `${h} 连不上：${res.error.message}`;
      continue;
    }
    const json = await res.json().catch(() => null);
    const code = json?.base_resp?.status_code;
    if (res.ok && code === 0) {
      host = h;
      return json;
    }
    last = `${h}：HTTP ${res.status}，${code ?? "?"} ${json?.base_resp?.status_msg ?? ""}`;
    // 鉴权不过（密钥属于另一个站）才换下一个站；别的错误直接报
    if (code !== 1004 && res.status !== 401) {
      break;
    }
  }
  throw new Error(`MiniMax 调用失败：${last}`);
}

async function chineseVoices() {
  const json = await call("/v1/get_voice", { voice_type: "system" });
  return (json.system_voice ?? [])
    .map((v) => ({ id: v.voice_id, name: v.voice_name ?? "" }))
    .filter((v) =>
      /Chinese \(Mandarin\)|^male-|^female-|^presenter_|^audiobook_/.test(v.id)
    );
}

function run(command, list) {
  const r = spawnSync(command, list, { encoding: "utf8" });
  if (r.error || r.status !== 0) {
    throw new Error(
      `${command} 失败：${r.error?.message ?? r.stderr.slice(-400)}`
    );
  }
  return r.stdout;
}

// 念的字和字幕的字不完全一样：品牌名念英文，百分数念中文（和 temp-voice 一致）
function spoken(text) {
  return text
    .replaceAll("Dr.Turing", "Doctor Turing")
    .replace(/(\d+)%/g, (_, n) => `百分之${n}`);
}

// 去掉头尾的静音，响度统一到 -16 LUFS（和 temp-voice 一致）
const CLEAN = [
  "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05",
  "areverse",
  "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05",
  "areverse",
  "loudnorm=I=-16:TP=-1.5:LRA=11",
].join(",");

async function speak(text, voice, speed, mp3) {
  let last = null;
  for (const model of MODELS) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: 新模型不可用时才退到旧的
      const json = await call("/v1/t2a_v2", {
        audio_setting: {
          bitrate: 256_000,
          channel: 1,
          format: "mp3",
          sample_rate: 44_100,
        },
        language_boost: "Chinese",
        model,
        output_format: "hex",
        stream: false,
        text,
        voice_setting: { pitch: 0, speed, voice_id: voice, vol: 1 },
      });
      writeFileSync(mp3, Buffer.from(json.data.audio, "hex"));
      return model;
    } catch (error) {
      last = error;
      if (!/2013|model/i.test(error.message)) {
        throw error;
      }
    }
  }
  throw last;
}

async function main() {
  KEY = apiKey();
  if (args.includes("--list")) {
    for (const v of await chineseVoices()) {
      console.log(`${v.id}\t${v.name}`);
    }
    console.log(`（站点 ${host}）`);
    return;
  }
  const speed = Number(flag("--speed") ?? 1);
  if (args.includes("--samples")) {
    const have = new Set(
      (await chineseVoices().catch(() => [])).map((v) => v.id)
    );
    const pick = (list) =>
      (have.size > 0 ? list.filter((v) => have.has(v)) : list).slice(0, 2);
    const voices = [...pick(MALE), ...pick(FEMALE)];
    const text = ["s2", "s7"]
      .map((id) => SCRIPT.find((s) => s.id === id).narration)
      .join("");
    const dir = join(root, "out/voice-samples");
    mkdirSync(dir, { recursive: true });
    for (const [i, voice] of voices.entries()) {
      const file = join(dir, `${i + 1}-${voice.replace(/[^\w-]+/g, "_")}.mp3`);
      try {
        // biome-ignore lint/performance/noAwaitInLoops: 一个一个念，免得撞频率限制
        const model = await speak(spoken(text), voice, speed, file);
        console.log(`样音 ${i + 1}：${voice}（${model}）→ ${file}`);
      } catch (error) {
        console.log(`样音 ${i + 1}：${voice} 念不了：${error.message}`);
      }
    }
    console.log(
      `站点 ${host}；挑好后：node scripts/minimax-voice.mjs --voice <voice_id>`
    );
    return;
  }
  const voice = flag("--voice");
  if (!voice) {
    throw new Error("用 --list、--samples 或 --voice <voice_id>");
  }
  const dir = join(root, "public/voice");
  mkdirSync(dir, { recursive: true });
  for (const s of SCRIPT) {
    const mp3 = join(dir, `${s.id}.mp3`);
    // biome-ignore lint/performance/noAwaitInLoops: 一段一段念
    const model = await speak(spoken(s.narration), voice, speed, mp3);
    run("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      mp3,
      "-af",
      CLEAN,
      "-ar",
      "48000",
      "-ac",
      "1",
      join(dir, `${s.id}.wav`),
    ]);
    console.log(`${s.id}：${voice}（${model}）`);
  }
  // 量时长、写 voice.json：和自己念的一样走 temp-voice --measure-only
  console.log(
    run(process.execPath, [
      join(here, "temp-voice.mjs"),
      "--measure-only",
      "--voice",
      `MiniMax ${voice}`,
    ])
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

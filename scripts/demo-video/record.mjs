// 演示视频录屏脚本 v2（规划和分镜见 README.md）。在 Mac 上跑：有界面的 Chrome + OBS 录 2560×1440@60，
// 脚本驱动线上网站按分镜 3–7 操作「产品演示学生」，同时记一份事件日志（点击坐标、界面出现时刻），
// 每个镜头按分镜自动判能不能用。用法：node record.mjs --help

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Actor, sleep } from "./lib/actor.mjs";
import {
  createStage,
  launchBrowser,
  measureFrame,
  setMarker,
} from "./lib/browser.mjs";
import {
  DEADLOCK,
  parseArgs,
  SHOTS,
  snapshotName,
  summaryTable,
  verdictFor,
} from "./lib/checks.mjs";
import { Director, REST } from "./lib/director.mjs";
import { CANVAS, VIEW } from "./lib/geometry.mjs";
import { TakeLog } from "./lib/log.mjs";
import { listWindows, pickWindow } from "./lib/macwin.mjs";
import { createRng, hashSeed } from "./lib/motion.mjs";
import { ObsRecorder, ObsSetupError } from "./lib/obs.mjs";
import { SHOT_SCRIPTS } from "./lib/shots.mjs";
import { Site } from "./lib/site.mjs";

const USAGE = `用法：node record.mjs [选项]

  --takes K         连录 K 条（每条从头到尾一遍，各自一个 OBS 文件和 out/<take>/ 目录），默认 1
  --from-shot N     从镜头 N 开始（读回存档 after-shot-(N-1)，不清空重来），默认 3
  --to-shot M       录到镜头 M 为止，默认 7
  --shot N          只录镜头 N（等于 --from-shot N --to-shot N）
  --no-obs          不连 OBS（彩排：只跑浏览器、日志、截图和自动判定）
  --obs-capture X   OBS 抓什么：window（默认，只抓这个 Chrome 窗口）或 display（整块屏幕再裁剪）
  --no-snapshots    镜头过了也不存档
  --seed S          鼠标轨迹和打字节奏的随机种子，默认 drturing

环境变量：SITE（默认线上地址，建议固定成某次部署的地址）、COURSE_ID（默认 comp5348）、
OBS_PASSWORD、OBS_URL（默认 ws://127.0.0.1:4455）、OBS_ENCODER（默认 apple_h264，可选 apple_hevc / x264）、
OBS_FORMAT（默认 mov）、BROWSER_CHANNEL（默认 chrome，没装就用 Playwright 自带的 chromium）`;

const DEFAULT_SITE = "https://dr-turing-81so.vercel.app";
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "out");
const SNAPSHOT_FILE = join(OUT, "snapshots.json");

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

function readSnapshots() {
  try {
    return JSON.parse(readFileSync(SNAPSHOT_FILE, "utf8"));
  } catch {
    return {};
  }
}

// 让 Mac 别睡：跟着本进程，进程退出它也退出
function keepAwake() {
  if (process.platform !== "darwin") {
    return null;
  }
  const child = spawn("caffeinate", ["-dimsu", "-w", String(process.pid)], {
    stdio: "ignore",
  });
  child.on("error", () => null);
  return child;
}

async function saveSnapshot(ctx, shot) {
  const name = snapshotName(shot);
  const res = await ctx.site.snapshot("save", name);
  if (res.routeMissing) {
    ctx.log.warn("线上还没有存档接口 /api/demo/snapshot，跳过存档");
    return;
  }
  if (!res.ok) {
    ctx.log.warn(`存档 ${name} 失败：${res.error}`);
    return;
  }
  const all = readSnapshots();
  all[name] = {
    chatUrl: ctx.page.url(),
    counts: res.json?.counts,
    savedAt: new Date().toISOString(),
    take: ctx.id,
  };
  writeFileSync(SNAPSHOT_FILE, `${JSON.stringify(all, null, 2)}\n`);
  ctx.log.mark("snapshot.save", { name });
}

// 开录前：清空重来或读档、带上产品演示学生的 cookie、打开页面、切到星图
async function prepare(ctx) {
  const { opts, site, log, page, d } = ctx;
  const from = opts.fromShot;
  let loaded = false;
  if (from > 3) {
    const name = snapshotName(from - 1);
    const res = await site.snapshot("load", name);
    loaded = res.ok;
    log.mark("snapshot.load", { name, ok: res.ok, status: res.status });
    if (!res.ok) {
      log.warn(
        res.routeMissing
          ? "线上还没有存档接口 /api/demo/snapshot"
          : `读档 ${name} 失败：${res.error}`
      );
    }
  }
  if (from === 3 || (from === 4 && !loaded)) {
    const res = await site.reset();
    if (!res.ok) {
      throw new Error(`清空重来失败：${res.error}`);
    }
    log.mark("reset", res.json ?? {});
  }
  await ctx.stage.context.clearCookies();
  await ctx.stage.context.addCookies([
    { name: "dr-student", url: ctx.SITE, value: "show" },
  ]);

  let url = `${ctx.SITE}/`;
  if (from === 5 || from === 6) {
    const saved = readSnapshots()[snapshotName(from - 1)]?.chatUrl;
    if (!saved) {
      throw new Error(
        `没有记下 ${snapshotName(from - 1)} 那时的对话地址（out/snapshots.json），先完整录一遍到镜头 ${from - 1}`
      );
    }
    // 只取路径（/chat/<id>），换成这次的 SITE：预览部署和正式站用的是同一个数据库
    url = `${ctx.SITE}${new URL(saved).pathname}`;
  }
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  const headers = response?.headers() ?? {};
  await d.waitReady();
  const html = await page.content();
  log.meta.deployment = {
    dpl: html.match(/dpl_[A-Za-z0-9]+/)?.[0] ?? null,
    url: page.url(),
    vercelCache: headers["x-vercel-cache"] ?? null,
    vercelId: headers["x-vercel-id"] ?? null,
  };
  if (
    ctx.detectedCourseId &&
    !process.env.COURSE_ID &&
    ctx.detectedCourseId !== site.courseId
  ) {
    log.warn(
      `页面用的课程是 ${ctx.detectedCourseId}，不是 ${site.courseId}，改用它`
    );
    site.courseId = ctx.detectedCourseId;
  }
  const point = await site.findPoint(DEADLOCK);
  if (!point) {
    throw new Error("课程图谱里找不到「死锁」");
  }
  d.deadlockId = point.id;
  log.meta.courseId = site.courseId;
  log.meta.deadlock = { id: point.id, name: point.name };
  await d.showGraphTab(false);
  await ctx.actor.place(REST);
  await sleep(800);
}

async function runTake(ctx) {
  const { opts, obs, log, d } = ctx;
  const verdict = {};
  let recording = false;
  let video = null;
  try {
    await prepare(ctx);
    await d.screenshot("ready");
    if (obs) {
      await obs.startRecording(ctx.dir);
      recording = true;
      ctx.onStop = async () => {
        if (recording) {
          recording = false;
          await obs.stopRecording();
        }
      };
      log.mark("record.start");
      await sleep(800);
      await obs
        .saveFrame(join(ctx.dir, "obs-frame.png"))
        .catch((error) => log.warn(`OBS 截帧失败：${error.message}`));
    }
    await d.flash("start");
    await sleep(600);
    for (let shot = opts.fromShot; shot <= opts.toShot; shot += 1) {
      log.mark(`shot.${shot}.start`);
      let facts;
      try {
        // biome-ignore lint/performance/noAwaitInLoops: 镜头按顺序录，后一镜接着前一镜的状态
        facts = await SHOT_SCRIPTS[shot](d, { site: ctx.SITE });
      } catch (error) {
        facts = { error: error.message, warnings: [] };
        log.mark("error", { message: error.message, shot, stack: error.stack });
        await d.screenshot(`shot${shot}-error`);
      }
      log.mark(`shot.${shot}.end`);
      verdict[shot] = {
        ...verdictFor(shot, facts),
        error: facts.error ?? null,
        facts,
      };
      console.log(
        `  镜头 ${shot}：${verdict[shot].pass ? "PASS" : "FAIL"}${verdict[shot].reasons.map((r) => `\n    x ${r}`).join("")}${verdict[shot].warnings.map((w) => `\n    ! ${w}`).join("")}`
      );
      if (facts.error) {
        for (let s = shot + 1; s <= opts.toShot; s += 1) {
          verdict[s] = {
            pass: false,
            reasons: [`镜头 ${shot} 出错，后面没录`],
            skipped: true,
            warnings: [],
          };
        }
        break;
      }
      if (verdict[shot].pass && opts.snapshots) {
        await saveSnapshot(ctx, shot);
      }
    }
    await sleep(1500);
  } catch (error) {
    log.mark("error", { message: error.message, stack: error.stack });
    verdict[opts.fromShot] ??= {
      error: error.message,
      pass: false,
      reasons: [`准备阶段出错：${error.message}`],
      warnings: [],
    };
    await d.screenshot("setup-error");
  } finally {
    await d.flash("end").catch(() => null);
    if (recording) {
      await sleep(700);
      recording = false;
      const path = await obs.stopRecording().catch((error) => {
        log.warn(`停止录制失败：${error.message}`);
        return null;
      });
      log.mark("record.stop", { path });
      video = path;
      if (path && existsSync(path)) {
        const target = join(ctx.dir, `screen${extname(path)}`);
        try {
          renameSync(path, target);
          video = target;
        } catch (error) {
          log.warn(`录屏文件没能挪到 ${target}：${error.message}`);
        }
      }
    }
    await d.flushPageLog();
    log.save({ video });
    writeFileSync(
      join(ctx.dir, "verdict.json"),
      `${JSON.stringify(verdict, null, 2)}\n`
    );
  }
  return { id: ctx.id, verdict, video };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  const SITE = (process.env.SITE ?? DEFAULT_SITE).replace(/\/+$/, "");
  if (SITE === DEFAULT_SITE) {
    console.log(
      "提示：SITE 用的是线上别名；正式录制建议固定成某次部署的地址（log.json 里记了 dpl 部署号）"
    );
  }
  mkdirSync(OUT, { recursive: true });
  // 同一秒里开了两次也不会写进同一个文件夹
  let run = stamp();
  for (let n = 2; existsSync(join(OUT, `${run}-t1`)); n += 1) {
    run = `${stamp()}-${n}`;
  }
  const caffeinate = keepAwake();
  const { browser, channel } = await launchBrowser(console.log);
  let obs = null;
  const current = { log: null };
  let stopHook = null;
  const onSignal = async () => {
    console.log("\n收到中断，停止录制…");
    await stopHook?.().catch(() => null);
    current.log?.save({ interrupted: true });
    await obs?.restore();
    process.exit(130);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  const takes = [];
  try {
    const frame = await measureFrame(browser);
    const stage = await createStage(browser, frame, (batch) =>
      current.log?.addPage(batch)
    );
    console.log(
      `浏览器 ${channel} ${browser.version()}，窗口 ${JSON.stringify(stage.bounds)}，标签栏+地址栏 ${frame.chromeTop}pt，${frame.dpr} 倍像素`
    );
    if (frame.dpr < 2) {
      console.log(
        "注意：Chrome 窗口不在 Retina 屏上，素材会是 1 倍像素（发虚）"
      );
    }
    let detectedCourseId = null;
    stage.page.on("request", (request) => {
      const m = request.url().match(/\/api\/course\/([^/?#]+)/);
      if (m && request.url().startsWith(SITE)) {
        detectedCourseId = decodeURIComponent(m[1]);
      }
    });

    let capture = null;
    if (opts.obs) {
      obs = new ObsRecorder(console.log);
      await obs.connect();
      await obs.selectProfile();
      await obs.configureVideo();
      await obs.configureOutput(OUT);
      await obs.ensureScene();
      await stage.page.goto("about:blank");
      let windowId = null;
      if (opts.capture === "window") {
        const win = pickWindow(listWindows(), {
          bounds: stage.bounds,
          pid: browser.process()?.pid,
        });
        if (win) {
          windowId = win.id;
        } else {
          console.log(
            "注意：没在窗口列表里找到录屏用的 Chrome 窗口，改成抓整块屏幕再裁剪"
          );
        }
      }
      capture = await obs.ensureCapture({
        geometry: stage.geometry,
        marker: (on) => setMarker(stage.page, on),
        mode: windowId ? "window" : "display",
        windowId,
      });
    }

    const site = new Site(
      stage.context.request,
      SITE,
      process.env.COURSE_ID ?? "comp5348"
    );
    for (let i = 1; i <= opts.takes; i += 1) {
      const id = `${run}-t${i}`;
      const dir = join(OUT, id);
      mkdirSync(dir, { recursive: true });
      const seed = hashSeed(`${opts.seed}:${i}`);
      const log = new TakeLog({
        dir,
        meta: {
          args: process.argv.slice(2),
          browser: { channel, version: browser.version() },
          capture,
          // 素材里网页内容的位置（Remotion 剪辑单的 viewport 字段）：OBS 裁剪后正好铺满画布
          footageViewport: opts.obs
            ? {
                height: CANVAS.height,
                scale: CANVAS.width / VIEW.width,
                width: CANVAS.width,
                x: 0,
                y: 0,
              }
            : null,
          obs: obs ? obs.info : null,
          seed: { hash: seed, text: `${opts.seed}:${i}` },
          site: SITE,
          startedAt: new Date().toISOString(),
          take: id,
          version: 2,
          viewport: { ...VIEW, dpr: stage.geometry.dpr },
          window: { bounds: stage.bounds, chromeTop: frame.chromeTop },
        },
      });
      current.log = log;
      const actor = new Actor(stage.page, log, createRng(seed));
      const d = new Director({ actor, dir, log, page: stage.page, site });
      console.log(
        `\n== 第 ${i}/${opts.takes} 条：${id}（镜头 ${opts.fromShot}–${opts.toShot}）`
      );
      const ctx = {
        actor,
        d,
        get detectedCourseId() {
          return detectedCourseId;
        },
        dir,
        id,
        log,
        obs,
        opts,
        page: stage.page,
        SITE,
        site,
        stage,
      };
      stopHook = () => ctx.onStop?.();
      // biome-ignore lint/performance/noAwaitInLoops: 一条录完再录下一条
      takes.push(await runTake(ctx));
    }
  } catch (error) {
    if (error instanceof ObsSetupError) {
      console.error(`\nx OBS 设置没成功：${error.message}`);
    } else {
      console.error(`\nx ${error.stack ?? error}`);
    }
    process.exitCode = 2;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await obs?.restore();
    await obs?.disconnect();
    await browser.close().catch(() => null);
    caffeinate?.kill();
  }

  if (takes.length > 0) {
    console.log(`\n${summaryTable(takes)}\n`);
    writeFileSync(
      join(OUT, `${run}-summary.json`),
      `${JSON.stringify(
        takes.map((t) => ({
          id: t.id,
          shots: Object.fromEntries(
            SHOTS.filter((s) => t.verdict[s]).map((s) => [
              s,
              {
                pass: t.verdict[s].pass,
                reasons: t.verdict[s].reasons,
                warnings: t.verdict[s].warnings,
              },
            ])
          ),
          video: t.video,
        })),
        null,
        2
      )}\n`
    );
    // 至少有一条每个镜头都过了才算成功
    const usable = takes.some((t) =>
      SHOTS.filter((s) => s >= opts.fromShot && s <= opts.toShot).every(
        (s) => t.verdict[s]?.pass
      )
    );
    if (!(usable || process.exitCode)) {
      process.exitCode = 1;
    }
  }
}

await main();

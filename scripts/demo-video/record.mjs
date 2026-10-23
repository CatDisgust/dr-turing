// 演示视频录屏脚本（分镜 https://claude.ai/artifact/82S8WU6PnK6W3b12Ttkkq2）。
// 在 Mac 上跑：cd scripts/demo-video && npm install && npx playwright install chromium
//            node record.mjs --take 4          # 只录镜头 4（试录）
//            node record.mjs --take 4-6        # 镜头 4 到 6 连着录（同一段对话）
// 录的是「产品演示学生」，开录前先在 /compare 点他的「清空重来」。
// 输出 out/<take>-<时间>.webm 和 out/<take>-<时间>.log（每个镜头开始的秒数，剪辑和配音对齐用）

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const SITE = process.env.SITE ?? "https://dr-turing-81so.vercel.app";
const SIZE = { height: 800, width: 1280 };
const REPLY_TIMEOUT = 120_000;

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const [from, to = from] = arg("take", "4").split("-").map(Number);
const headed = process.argv.includes("--headed");

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const marks = [];
let t0 = 0;
function mark(text) {
  const s = ((Date.now() - t0) / 1000).toFixed(1);
  marks.push(`${s}s ${text}`);
  console.log(`[${s}s] ${text}`);
}

// 录屏里看不到系统鼠标：页面里画一个假光标，跟着 mouse.move 走
const CURSOR = `
  (() => {
    if (document.getElementById("__cursor")) return;
    const c = document.createElement("div");
    c.id = "__cursor";
    Object.assign(c.style, {
      position: "fixed", left: "0", top: "0", width: "18px", height: "18px",
      borderRadius: "50%", background: "rgba(37,46,60,.55)", border: "2px solid #fff",
      boxShadow: "0 1px 4px rgba(0,0,0,.35)", pointerEvents: "none", zIndex: "2147483647",
      transform: "translate(-100px,-100px)", transition: "transform .05s linear",
    });
    document.documentElement.appendChild(c);
    addEventListener("mousemove", (e) => {
      c.style.transform = "translate(" + (e.clientX - 9) + "px," + (e.clientY - 9) + "px)";
    }, true);
    addEventListener("mousedown", () => { c.style.background = "rgba(0,113,165,.75)"; }, true);
    addEventListener("mouseup", () => { c.style.background = "rgba(37,46,60,.55)"; }, true);
  })();
`;

let mouse = { x: 640, y: 400 };
async function moveTo(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("元素不在画面里");
  }
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const steps = Math.max(
    12,
    Math.round(Math.hypot(x - mouse.x, y - mouse.y) / 18)
  );
  await page.mouse.move(x, y, { steps });
  mouse = { x, y };
}
async function click(page, locator, after = 600) {
  await moveTo(page, locator);
  await pause(250);
  await locator.click();
  await pause(after);
}
async function type(page, locator, text) {
  await click(page, locator, 200);
  await locator.pressSequentially(text, { delay: 110 });
  await pause(500);
}

function lastText(page) {
  return page
    .getByTestId("message-content")
    .last()
    .innerText()
    .catch(() => "");
}

// 等这一轮导师回复写完：停止按钮消失、最后一条导师消息不再变长
async function waitReply(page) {
  await page
    .getByTestId("stop-button")
    .waitFor({ state: "visible", timeout: 15_000 })
    .catch(() => null);
  await page
    .getByTestId("stop-button")
    .waitFor({ state: "hidden", timeout: REPLY_TIMEOUT });
  let last = "";
  for (let i = 0; i < 20; i += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: 一次一次等文字停下来
    const now = await lastText(page);
    if (now === last && now !== "") {
      break;
    }
    last = now;
    await pause(500);
  }
  await pause(800);
}

async function ask(page, text) {
  await type(page, page.getByTestId("multimodal-input"), text);
  await click(page, page.getByTestId("send-button"), 300);
  await waitReply(page);
}

async function resetShowStudent(context) {
  const page = await context.newPage();
  await page.goto(`${SITE}/compare`);
  await page.getByTestId("show-reset").click();
  await page.getByTestId("show-result").waitFor({ timeout: 60_000 });
  console.log(await page.getByTestId("show-result").innerText());
  await page.close();
}

// ---- 镜头 ----
const SHOTS = {
  // 镜头 3：对话页 + 右边星图（产品演示学生）
  3: async (page) => {
    mark("镜头 3 看懂和真会分开算");
    await page.mouse.move(1000, 400, { steps: 30 });
    mouse = { x: 1000, y: 400 };
    await pause(6000);
  },
  // 镜头 4：问死锁 → 标签“从你会的…讲起” → 动手模拟点 4 下 → 检查题卡片
  4: async (page) => {
    mark("镜头 4 输入问题");
    await ask(page, "加锁为什么会死锁？");
    mark("镜头 4 回复写完");
    const startFrom = page.getByTestId("start-from").last();
    if (await startFrom.isVisible().catch(() => false)) {
      await moveTo(page, startFrom);
      mark(`标签：${await startFrom.innerText()}`);
      await pause(2500);
    } else {
      mark("⚠ 这次标签上没有“从你会的…讲起”");
    }
    const sim = page.getByTestId("deadlock-sim").last();
    if (await sim.isVisible().catch(() => false)) {
      mark("镜头 4 动手模拟");
      await sim.scrollIntoViewIfNeeded();
      await pause(1500);
      for (const t of [1, 2, 1, 2]) {
        // biome-ignore lint/performance/noAwaitInLoops: 点击要按顺序
        await click(page, sim.getByTestId(`sim-step-${t}`), 1100);
      }
      await moveTo(page, sim.getByTestId("sim-status"));
      await pause(2500);
    } else {
      mark("⚠ 这次没有出死锁模拟");
    }
    const card = page.getByTestId("check-card").last();
    if (await card.isVisible().catch(() => false)) {
      await card.scrollIntoViewIfNeeded();
      mark("镜头 4 检查题卡片");
      await moveTo(page, card);
      await pause(3000);
    } else {
      mark("⚠ 这一轮没有出检查题卡片（可能要学生再说一句才出题）");
    }
  },
  // 镜头 5：很确定却答错 → 红条 → 反例追问 → 再独立答对
  5: async (page) => {
    mark("镜头 5 很确定却答错");
    await type(
      page,
      page.getByTestId("check-answer"),
      "还会。只要加了锁，就可能死锁。"
    );
    await click(page, page.getByTestId("confidence-sure"));
    await click(page, page.getByTestId("check-submit"), 300);
    await waitReply(page);
    const line = page.getByTestId("graded-line").last();
    if (await line.isVisible().catch(() => false)) {
      await moveTo(page, line);
      mark(`判分：${await line.innerText()}`);
    }
    await pause(3000);
    mark("镜头 5 反例追问（下面的回答要按当时的题现填，先停在这里）");
  },
  // 镜头 6：课外追问 → 结束本次学习 → 我的星图
  6: async (page) => {
    mark("镜头 6 课外追问");
    await ask(page, "操作系统课里的哲学家就餐问题，和这个是一回事吗？");
    mark("镜头 6 结束本次学习");
    await click(page, page.getByTestId("end-session"));
    await page
      .getByTestId("session-report")
      .waitFor({ timeout: REPLY_TIMEOUT });
    await pause(2000);
    await click(page, page.getByTestId("open-personal"), 2000);
    mark("镜头 6 我的星图");
    await pause(5000);
  },
};

// ---- 开录 ----
async function main() {
  mkdirSync("out", { recursive: true });
  const browser = await chromium.launch({ headless: !headed });
  const setup = await browser.newContext({ viewport: SIZE });
  await resetShowStudent(setup);
  await setup.close();

  const context = await browser.newContext({
    recordVideo: { dir: "out", size: SIZE },
    viewport: SIZE,
  });
  await context.addCookies([{ name: "dr-student", url: SITE, value: "show" }]);
  await context.addInitScript(CURSOR);
  const page = await context.newPage();
  t0 = Date.now();
  await page.goto(SITE);
  await page.getByTestId("multimodal-input").waitFor();
  await pause(1500);
  mark("页面就绪");

  let failed = null;
  try {
    for (let n = from; n <= to; n += 1) {
      if (SHOTS[n]) {
        // biome-ignore lint/performance/noAwaitInLoops: 镜头按顺序录
        await SHOTS[n](page);
      }
    }
  } catch (error) {
    failed = error;
    mark(`✗ 出错：${error.message}`);
    await page.screenshot({ path: "out/error.png" });
  }
  await pause(1000);
  const video = page.video();
  await context.close();
  await browser.close();

  const name = `take${from}${to === from ? "" : `-${to}`}-${new Date().toISOString().slice(11, 19).replaceAll(":", "")}`;
  renameSync(await video.path(), `out/${name}.webm`);
  writeFileSync(`out/${name}.log`, `${marks.join("\n")}\n`);
  console.log(`录好了：out/${name}.webm`);
  if (failed) {
    process.exitCode = 1;
  }
}

await main();

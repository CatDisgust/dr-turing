import { chromium } from "playwright";
import { VIEW } from "./geometry.mjs";
import { installDemoLog } from "./inpage.mjs";

// 有界面的 Chrome（装了就用 Chrome，否则用 Playwright 自带的 Chromium）：网页内容正好 1280×720 CSS 像素、
// Retina 2 倍、简体中文、sRGB。窗口放在固定位置，OBS 抓这个窗口。
// 视口用 Playwright 固定成 1280×720，窗口比它多留一圈边（右、下），避开 macOS 窗口的圆角

export const WINDOW = {
  left: Number(process.env.WINDOW_LEFT ?? 24),
  top: Number(process.env.WINDOW_TOP ?? 64),
};
const MARGIN = 24;
export const BINDING = "__demoLogPush";

export async function launchBrowser(say) {
  const options = {
    args: [
      "--force-color-profile=srgb",
      "--lang=zh-CN",
      `--window-position=${WINDOW.left},${WINDOW.top}`,
      "--window-size=1320,860",
      "--hide-crash-restore-bubble",
    ],
    headless: false,
    // 去掉“Chrome 正受到自动测试软件的控制”提示条
    ignoreDefaultArgs: ["--enable-automation"],
  };
  // 自测用：指定浏览器文件、无界面（录制时别设）
  if (process.env.BROWSER_EXECUTABLE) {
    const browser = await chromium.launch({
      ...options,
      executablePath: process.env.BROWSER_EXECUTABLE,
      headless: process.env.HEADLESS === "1",
    });
    return { browser, channel: "custom" };
  }
  const channel = process.env.BROWSER_CHANNEL ?? "chrome";
  if (channel !== "chromium") {
    try {
      return {
        browser: await chromium.launch({ ...options, channel }),
        channel,
      };
    } catch (error) {
      say(
        `注意：没能启动 ${channel}（${String(error.message).split("\n")[0]}），改用 Playwright 自带的 Chromium`
      );
    }
  }
  return { browser: await chromium.launch(options), channel: "chromium" };
}

async function windowOf(context, page) {
  const cdp = await context.newCDPSession(page);
  const { windowId } = await cdp.send("Browser.getWindowForTarget");
  return { cdp, windowId };
}

// 用一个不固定视口的临时窗口量浏览器的“框”：标签栏 + 地址栏多高、左右边多宽，屏幕多大，几倍像素
export async function measureFrame(browser) {
  const probe = await browser.newContext({ viewport: null });
  try {
    const page = await probe.newPage();
    const { cdp, windowId } = await windowOf(probe, page);
    await cdp.send("Browser.setWindowBounds", {
      bounds: { height: 860, left: WINDOW.left, top: WINDOW.top, width: 1320 },
      windowId,
    });
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => ({
      dpr: devicePixelRatio,
      ih: innerHeight,
      iw: innerWidth,
      oh: outerHeight,
      ow: outerWidth,
      screen: { height: screen.height, width: screen.width },
    }));
    return {
      chromeSide: m.ow - m.iw,
      chromeTop: m.oh - m.ih,
      dpr: m.dpr,
      screen: m.screen,
    };
  } finally {
    await probe.close();
  }
}

// 录制用的窗口：所有 take 都用这一个窗口（OBS 抓的窗口不变）
export async function createStage(browser, frame, onEvents) {
  const dpr = Math.max(1, Math.round(frame.dpr));
  const context = await browser.newContext({
    colorScheme: "light",
    deviceScaleFactor: dpr,
    locale: "zh-CN",
    reducedMotion: "no-preference",
    viewport: { ...VIEW },
  });
  await context.exposeBinding(BINDING, (_source, batch) => onEvents(batch));
  await context.addInitScript(installDemoLog, { binding: BINDING });
  const page = await context.newPage();
  const { cdp, windowId } = await windowOf(context, page);
  await cdp.send("Browser.setWindowBounds", {
    bounds: {
      height: VIEW.height + frame.chromeTop + MARGIN,
      left: WINDOW.left,
      top: WINDOW.top,
      width: VIEW.width + frame.chromeSide + MARGIN,
    },
    windowId,
  });
  await page.waitForTimeout(400);
  const { bounds } = await cdp.send("Browser.getWindowBounds", { windowId });
  await page.bringToFront();
  return {
    bounds,
    context,
    geometry: {
      contentLeft: frame.chromeSide / 2,
      contentTop: frame.chromeTop,
      dpr,
      outer: bounds,
      screen: frame.screen,
    },
    page,
    windowId,
  };
}

// OBS 校准用：网页四周画一圈 6px 品红框
export function setMarker(page, on) {
  return page.evaluate((show) => {
    document.getElementById("__demo-marker")?.remove();
    if (show) {
      const el = document.createElement("div");
      el.id = "__demo-marker";
      el.style.cssText =
        "position:fixed;inset:0;border:6px solid #ff00ff;box-sizing:border-box;z-index:2147483647;pointer-events:none";
      document.documentElement.append(el);
    }
  }, on);
}

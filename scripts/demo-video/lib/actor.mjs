import { VIEW } from "./geometry.mjs";
import {
  clamp,
  mousePath,
  pointInBox,
  scrollDurationMs,
  scrollTarget,
  typingDelays,
} from "./motion.mjs";

// 像人一样操作页面：真的移动 Playwright 鼠标（沿缓动曲线，每秒约 60 步），点之前先停一下，
// 打字有抖动的间隔，滚动是自己逐帧算的平滑滚动（不用 scrollIntoViewIfNeeded 的瞬间跳）。
// 光标不画在页面里，后期在 Remotion 里按日志里的 pointermove 画

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 在页面里找元素所在的滚动容器（和 smoothScroll 里那份一样）
function scrollMetrics(el) {
  let sc = document.scrollingElement;
  for (let p = el.parentElement; p; p = p.parentElement) {
    const style = getComputedStyle(p);
    if (
      /(auto|scroll)/.test(style.overflowY) &&
      p.scrollHeight > p.clientHeight + 1
    ) {
      sc = p;
      break;
    }
  }
  const r = el.getBoundingClientRect();
  const viewTop =
    sc === document.scrollingElement ? 0 : sc.getBoundingClientRect().top;
  return {
    height: r.height,
    maxScroll: sc.scrollHeight - sc.clientHeight,
    scrollTop: sc.scrollTop,
    top: r.top - viewTop,
    viewHeight:
      sc === document.scrollingElement ? innerHeight : sc.clientHeight,
  };
}

function smoothScroll(el, { target, duration }) {
  let sc = document.scrollingElement;
  for (let p = el.parentElement; p; p = p.parentElement) {
    const style = getComputedStyle(p);
    if (
      /(auto|scroll)/.test(style.overflowY) &&
      p.scrollHeight > p.clientHeight + 1
    ) {
      sc = p;
      break;
    }
  }
  const from = sc.scrollTop;
  const dy = target - from;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  return new Promise((resolve) => {
    if (Math.abs(dy) < 2) {
      resolve(from);
      return;
    }
    const start = performance.now();
    let still = 0;
    let lastTop = -1;
    const settle = () => {
      // 动画走完再等滚动位置连续 3 帧不变
      still = sc.scrollTop === lastTop ? still + 1 : 0;
      lastTop = sc.scrollTop;
      if (still >= 3) {
        resolve(sc.scrollTop);
        return;
      }
      requestAnimationFrame(settle);
    };
    const step = (now) => {
      const k = Math.min(1, (now - start) / duration);
      sc.scrollTo({ behavior: "instant", top: from + dy * ease(k) });
      if (k < 1) {
        requestAnimationFrame(step);
      } else {
        requestAnimationFrame(settle);
      }
    };
    requestAnimationFrame(step);
  });
}

export class Actor {
  constructor(page, log, rng) {
    this.page = page;
    this.log = log;
    this.rng = rng;
    this.mouse = { x: 470, y: 420 };
  }

  // 不录的准备阶段：鼠标直接放到某处
  async place(point) {
    await this.page.mouse.move(point.x, point.y);
    this.mouse = { ...point };
  }

  async moveTo(point) {
    const target = {
      x: clamp(point.x, 2, VIEW.width - 2),
      y: clamp(point.y, 2, VIEW.height - 2),
    };
    const path = mousePath(this.mouse, target, this.rng);
    const start = performance.now();
    for (const p of path) {
      // biome-ignore lint/performance/noAwaitInLoops: 轨迹一步一步走，按时间表发 mousemove
      await this.page.mouse.move(p.x, p.y);
      const wait = start + p.dt - performance.now();
      if (wait > 0) {
        await sleep(wait);
      }
    }
    this.mouse = target;
  }

  // 等元素的框稳定（对话框弹出动画、星图布局）
  async stableBox(locator, timeout = 3000) {
    await locator.waitFor({ state: "visible", timeout: 30_000 });
    const until = Date.now() + timeout;
    let last = await locator.boundingBox();
    while (Date.now() < until) {
      // biome-ignore lint/performance/noAwaitInLoops: 隔一会儿再量一次
      await sleep(120);
      const now = await locator.boundingBox();
      if (
        last &&
        now &&
        Math.abs(now.x - last.x) < 0.5 &&
        Math.abs(now.y - last.y) < 0.5 &&
        Math.abs(now.width - last.width) < 0.5 &&
        Math.abs(now.height - last.height) < 0.5
      ) {
        return now;
      }
      last = now;
    }
    if (!last) {
      throw new Error("元素不在画面里");
    }
    return last;
  }

  // 平滑滚动，让元素完整露出（block=center 放到正中）
  async scrollIntoView(locator, { block = "nearest", margin = 32 } = {}) {
    await locator.waitFor({ state: "visible", timeout: 30_000 });
    const metrics = await locator.evaluate(scrollMetrics);
    const target = scrollTarget(metrics, { block, margin });
    const dy = target - metrics.scrollTop;
    if (Math.abs(dy) < 2) {
      return;
    }
    await locator.evaluate(smoothScroll, {
      duration: scrollDurationMs(dy),
      target,
    });
    await sleep(120);
  }

  async moveToLocator(
    locator,
    { spread = 0.2, scroll = true, at, block } = {}
  ) {
    if (scroll) {
      await this.scrollIntoView(locator, { block });
    }
    const box = await this.stableBox(locator);
    const point = at ? at(box) : pointInBox(box, this.rng, spread);
    await this.moveTo(point);
    return { box, point: this.mouse };
  }

  async hover(locator, holdMs, label, options = {}) {
    await this.moveToLocator(locator, options);
    this.log.mark("hold", { label, ms: holdMs });
    await sleep(holdMs);
  }

  async click(locator, { after = 350, label, ...options } = {}) {
    const { point } = await this.moveToLocator(locator, options);
    const until = Date.now() + 20_000;
    // biome-ignore lint/performance/noAwaitInLoops: 等按钮能点
    while (!(await locator.isEnabled().catch(() => false))) {
      if (Date.now() > until) {
        throw new Error(`「${label ?? "按钮"}」一直是灰的`);
      }
      await sleep(200);
    }
    // 确认鼠标下面就是它（没有被别的东西挡住），否则退回 Playwright 自己的点击
    const isHit = () =>
      locator.evaluate((el, p) => {
        const top = document.elementFromPoint(p.x, p.y);
        return Boolean(top) && (el === top || el.contains(top));
      }, point);
    let hit = await isHit();
    // 鼠标路过别的按钮时弹出的提示（如消息上的“Copy”）可能正好盖在目标上，鼠标进了提示框它就不收：
    // 按 Esc 关掉再看（2026-10-24 第三条就卡在“结束本次学习”上）
    if (!hit && (await this.tooltipOpen())) {
      await this.page.keyboard.press("Escape");
      await sleep(300);
      hit = await isHit();
    }
    await sleep(this.rng.range(80, 150));
    if (hit) {
      await this.page.mouse.down();
      await sleep(this.rng.range(60, 100));
      await this.page.mouse.up();
    } else {
      this.log.warn(`「${label}」被挡住了，改用 Playwright 点击（光标会跳）`);
      await locator.click({ timeout: 10_000 });
      const box = await locator.boundingBox();
      if (box) {
        this.mouse = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }
    }
    this.log.mark("click", { hit, label, x: this.mouse.x, y: this.mouse.y });
    await sleep(after);
  }

  async tooltipOpen() {
    return (
      (await this.page
        .locator('[data-slot="tooltip-content"], [role="tooltip"]')
        .count()
        .catch(() => 0)) > 0
    );
  }

  async type(locator, text, label) {
    await this.click(locator, { after: 200, label: label ?? "输入框" });
    const current = await locator.inputValue().catch(() => "");
    if (current) {
      await this.page.keyboard.press("ControlOrMeta+A");
      await this.page.keyboard.press("Backspace");
    }
    this.log.mark("type.start", { label, text });
    const delays = typingDelays(text, this.rng);
    for (const [i, ch] of [...text].entries()) {
      // biome-ignore lint/performance/noAwaitInLoops: 一个字一个字打
      await this.page.keyboard.type(ch);
      await sleep(delays[i]);
    }
    const value = await locator.inputValue().catch(() => text);
    if (value !== text) {
      this.log.warn("输入框里的字和要打的不一样，直接填进去", { value });
      await locator.fill(text);
    }
    this.log.mark("type.end", { label });
    await sleep(this.rng.range(250, 400));
  }
}

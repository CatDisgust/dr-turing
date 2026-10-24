// 注入到页面里的事件日志（context.addInitScript）。时间一律是毫秒时间戳：performance.timeOrigin + performance.now()。
// 记：鼠标 pointermove/down/up（CSS 像素坐标、命中元素的 data-testid 和它的框）、滚动位置、按键和输入、
// 应用自己的事件（归类到哪个点、批改结果），以及关键界面的出现和变化（导师在回复、标签、模拟、检查题、
// 判分条、会话报告、我的星图……）。每 200ms 批量交给 Node 那边（exposeBinding），换页前也会交一次。
// 这个函数会被序列化后在页面里运行，所以不能引用外面的任何东西。

export function installDemoLog(config) {
  if (window.top !== window || window.__demo) {
    return;
  }
  const now = () => performance.timeOrigin + performance.now();
  const r1 = (x) => Math.round(x * 10) / 10;
  const buffer = [];
  const push = (e) => {
    buffer.push({ src: "page", t: r1(now()), ...e });
  };
  const flush = () => {
    const send = window[config.binding];
    if (typeof send !== "function" || buffer.length === 0) {
      return;
    }
    const batch = buffer.splice(0, buffer.length);
    Promise.resolve(send(batch)).catch(() => {
      buffer.unshift(...batch);
    });
  };
  setInterval(flush, 200);
  addEventListener("pagehide", flush);

  const rectOf = (el) => {
    if (!el) {
      return null;
    }
    const r = el.getBoundingClientRect();
    return { h: r1(r.height), w: r1(r.width), x: r1(r.x), y: r1(r.y) };
  };
  const testidOf = (target) => {
    const el =
      target instanceof Element ? target.closest("[data-testid]") : null;
    return el
      ? { el, testid: el.getAttribute("data-testid") }
      : { el: null, testid: null };
  };

  for (const type of ["pointermove", "pointerdown", "pointerup"]) {
    addEventListener(
      type,
      (e) => {
        const { el, testid } = testidOf(e.target);
        push({
          buttons: e.buttons,
          rect: rectOf(el),
          testid,
          type,
          x: r1(e.clientX),
          y: r1(e.clientY),
        });
      },
      { capture: true, passive: true }
    );
  }
  addEventListener(
    "keydown",
    (e) =>
      push({ key: e.key, testid: testidOf(e.target).testid, type: "keydown" }),
    true
  );
  // 中文是 insertText 打进去的，没有 keydown，只有 input
  addEventListener(
    "input",
    (e) =>
      push({
        data: e.data ?? null,
        inputType: e.inputType ?? null,
        length: e.target?.value?.length ?? null,
        testid: testidOf(e.target).testid,
        type: "input",
      }),
    true
  );

  const describe = (el) => {
    if (el === document.scrollingElement) {
      return "window";
    }
    const id = el.getAttribute?.("data-testid");
    if (id) {
      return id;
    }
    if (el.querySelector?.('[data-testid^="message-"]')) {
      return "messages";
    }
    const inside = testidOf(el).testid;
    return inside ? `in:${inside}` : (el.tagName?.toLowerCase() ?? "?");
  };
  const scrolled = new Set();
  let scrollTimer = 0;
  document.addEventListener(
    "scroll",
    (e) => {
      scrolled.add(
        e.target === document ? document.scrollingElement : e.target
      );
      if (scrollTimer) {
        return;
      }
      scrollTimer = requestAnimationFrame(() => {
        scrollTimer = 0;
        for (const el of scrolled) {
          push({
            client: el.clientHeight,
            height: el.scrollHeight,
            left: r1(el.scrollLeft),
            target: describe(el),
            top: r1(el.scrollTop),
            type: "scroll",
          });
        }
        scrolled.clear();
      });
    },
    { capture: true, passive: true }
  );

  for (const name of ["dr:node-touched", "dr:graded", "dr:learner-refresh"]) {
    addEventListener(name, (e) =>
      push({ detail: e.detail ?? null, name, type: "app" })
    );
  }

  const q = (sel) => document.querySelector(sel);
  const last = (sel) => {
    const all = document.querySelectorAll(sel);
    return all.length > 0 ? all.item(all.length - 1) : null;
  };
  const textOf = (el, n = 400) =>
    el ? el.innerText.replace(/\s+/g, " ").trim().slice(0, n) : null;

  // 导师是不是还在回复：思考中占位、停止按钮、发送键变成 Stop，或者有对话时“结束本次学习”是灰的
  const busy = () => {
    const end = q('[data-testid="end-session"]');
    const users = document.querySelectorAll(
      '[data-testid="message-user"]'
    ).length;
    return Boolean(
      q('[data-testid="message-assistant-loading"]') ||
        q('[data-testid="stop-button"]') ||
        q('[data-testid="send-button"]')?.getAttribute("aria-label") ===
          "Stop" ||
        (users > 0 && end?.disabled)
    );
  };

  const lastOf = (sel, n) => () => {
    const el = last(sel);
    return {
      count: document.querySelectorAll(sel).length,
      el,
      value: textOf(el, n),
    };
  };
  const present = (sel) => () => {
    const el = q(sel);
    return { el, value: Boolean(el) };
  };
  const WATCH = {
    "answer-bar": present('[data-testid="answer-bar"]'),
    assistant: () => ({
      value: document.querySelectorAll('[data-testid="message-assistant"]')
        .length,
    }),
    busy: () => ({ value: busy() }),
    "check-card": lastOf('[data-testid="check-card"]'),
    "deadlock-sim": lastOf('[data-testid="deadlock-sim"]', 40),
    "graded-line": lastOf('[data-testid="graded-line"]'),
    "lesson-name": lastOf('[data-testid="lesson-name"]'),
    "personal-panel": present('[data-testid="personal-panel"]'),
    plan: lastOf('[data-testid="plan"] > summary'),
    // 导师回复里已经露出文字的条数：从“思考中”变成有字的那一刻，后期据此加速思考的等待
    "reply-shown": () => ({
      value: [
        ...document.querySelectorAll('[data-testid="message-assistant"]'),
      ].filter((m) => m.querySelector('[data-testid="message-content"]'))
        .length,
    }),
    "report-concepts": lastOf('[data-testid="report-concepts"]'),
    "retry-notice": present('[data-testid="retry-notice"]'),
    "session-report": lastOf('[data-testid="session-report"]', 200),
    "sim-status": lastOf('[data-testid="sim-status"]'),
    "star-name": lastOf('[data-testid="star-name"]'),
    "start-from": lastOf('[data-testid="start-from"]'),
    "stop-button": present('[data-testid="stop-button"]'),
  };
  const seen = {};
  let href = "";
  let checkTimer = 0;
  const check = () => {
    checkTimer = 0;
    if (location.href !== href) {
      ({ href } = location);
      push({ type: "nav", url: href });
    }
    for (const [key, read] of Object.entries(WATCH)) {
      const { el, value, count } = read();
      const sig = JSON.stringify([value, count]);
      if (seen[key] === sig) {
        continue;
      }
      seen[key] = sig;
      push({ count, key, rect: rectOf(el), type: "ui", value });
      if (key === "busy") {
        push({ state: value ? "start" : "end", type: "stream" });
      }
    }
  };
  const schedule = () => {
    if (!checkTimer) {
      checkTimer = setTimeout(check, 60);
    }
  };
  new MutationObserver(schedule).observe(document, {
    attributeFilter: ["disabled", "aria-label", "open", "data-state"],
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });
  setInterval(schedule, 500);

  addEventListener("DOMContentLoaded", () =>
    push({
      dpr: devicePixelRatio,
      type: "page",
      url: location.href,
      viewport: { h: innerHeight, w: innerWidth },
    })
  );

  // 闪白：盖一层白，至少 frames 帧且至少 ms 毫秒，时间记进日志；后期在素材里找这一帧对时间
  const flash = (ms = 50, frames = 3, color = "#ffffff") =>
    new Promise((resolve) => {
      const cover = document.createElement("div");
      cover.style.cssText = `position:fixed;inset:0;background:${color};z-index:2147483647;pointer-events:none`;
      let shownAt = 0;
      let n = 0;
      const step = () => {
        if (!shownAt) {
          document.documentElement.append(cover);
          shownAt = now();
          requestAnimationFrame(step);
          return;
        }
        n += 1;
        if (n < frames || now() - shownAt < ms) {
          requestAnimationFrame(step);
          return;
        }
        cover.remove();
        const hiddenAt = now();
        push({
          color,
          frames: n,
          t: r1(shownAt),
          tHide: r1(hiddenAt),
          type: "flash",
        });
        flush();
        requestAnimationFrame(() =>
          resolve({ frames: n, tHide: hiddenAt, tShow: shownAt })
        );
      };
      requestAnimationFrame(step);
    });

  // 测帧率：盖一层深色，一根白条每帧挪一格，持续 ms 毫秒。每一帧画面都不一样，
  // 后期数这段素材里不重复的帧，就是 OBS 实际录到的帧率
  const probe = (ms = 2000) =>
    new Promise((resolve) => {
      const cover = document.createElement("div");
      cover.style.cssText =
        "position:fixed;inset:0;background:#101010;z-index:2147483647;pointer-events:none";
      const bar = document.createElement("div");
      bar.style.cssText =
        "position:absolute;top:0;bottom:0;width:24px;left:0;background:#ffffff";
      cover.append(bar);
      document.documentElement.append(cover);
      const start = now();
      let n = 0;
      const step = () => {
        n += 1;
        bar.style.transform = `translateX(${(n * 24) % innerWidth}px)`;
        if (now() - start < ms) {
          requestAnimationFrame(step);
          return;
        }
        cover.remove();
        const end = now();
        push({ frames: n, t: r1(start), tEnd: r1(end), type: "probe" });
        flush();
        requestAnimationFrame(() => resolve({ end, frames: n, start }));
      };
      requestAnimationFrame(step);
    });

  window.__demo = { busy, flash, flush, probe, version: 2 };
}

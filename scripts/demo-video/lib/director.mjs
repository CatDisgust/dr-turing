import { join } from "node:path";
import { sleep } from "./actor.mjs";
import { DEADLOCK, findStar, linkedTo, sessionCount } from "./checks.mjs";

// 导演：镜头里反复用到的大动作——发一句话并等导师回完、答检查题、结束学习等复核、
// 打开我的星图点一颗星——以及收集每个镜头的“事实”。镜头脚本在 shots.mjs

export const REPLY_TIMEOUT = 150_000;
export const REVIEW_TIMEOUT = 330_000;
// 不操作时鼠标停在对话区中间偏下
export const REST = { x: 470, y: 430 };

export class Director {
  constructor({ page, actor, log, site, dir, deadlockId }) {
    this.page = page;
    this.actor = actor;
    this.log = log;
    this.site = site;
    this.dir = dir;
    this.deadlockId = deadlockId;
    this.dumped = 0;
    this.shots = 0;
  }

  get assistants() {
    return this.page.getByTestId("message-assistant");
  }

  lastAssistant() {
    return this.assistants.last();
  }

  assistantCount() {
    return this.assistants.count();
  }

  async visible(locator) {
    return await locator.isVisible().catch(() => false);
  }

  async textOf(locator) {
    if (!(await this.visible(locator))) {
      return null;
    }
    return (await locator.innerText()).replace(/\s+/g, " ").trim();
  }

  async screenshot(name) {
    this.shots += 1;
    const path = join(
      this.dir,
      `${String(this.shots).padStart(2, "0")}-${name}.png`
    );
    await this.page
      .screenshot({ caret: "initial", path, scale: "css" })
      .catch((error) => this.log.warn(`截图失败：${error.message}`));
    this.log.mark("screenshot", { path });
  }

  async flushPageLog() {
    await this.page.evaluate(() => window.__demo?.flush()).catch(() => null);
    await sleep(100);
  }

  // 2 秒测帧率的动画（白条每帧挪一格），align.mjs 会数这段素材里不重复的帧
  async probe() {
    const result = await this.page.evaluate(() => window.__demo.probe(2000));
    this.log.mark("probe", {
      fps: Math.round((result.frames / (result.end - result.start)) * 1000),
    });
    return result;
  }

  async flash(label) {
    const result = await this.page.evaluate(() => window.__demo.flash(50, 3));
    this.log.mark(`flash.${label}`, {
      tHide: result.tHide,
      tShow: result.tShow,
    });
    return result;
  }

  // 页面上能看到的对话原文追加到 tutor-text.md（只追加新出现的）
  async dumpTutor(label) {
    const items = await this.page.evaluate(() =>
      [
        ...document.querySelectorAll(
          '[data-testid="message-user"], [data-testid="message-assistant"]'
        ),
      ].map((el) => ({
        role: el.getAttribute("data-testid") === "message-user" ? "你" : "导师",
        text: el.innerText,
      }))
    );
    for (const item of items.slice(this.dumped)) {
      this.log.tutor(`${label} · ${item.role}`, item.text);
    }
    this.dumped = Math.max(this.dumped, items.length);
  }

  // 等导师这一轮回完：先看到开始（占位 / 停止键 / 结束键变灰），再等它结束、最后一条回复的字 1.2 秒不再变
  async waitReply(label, before) {
    const done = this.log.wait(`reply.${label}`);
    await this.page
      .waitForFunction(
        (n) =>
          window.__demo?.busy() ||
          document.querySelectorAll('[data-testid="message-assistant"]')
            .length > n,
        before,
        { polling: 100, timeout: 20_000 }
      )
      .catch(() => this.log.warn(`${label}：20 秒内没看到导师开始回复`));
    const until = Date.now() + REPLY_TIMEOUT;
    let lastText = null;
    let stableSince = 0;
    for (;;) {
      // biome-ignore lint/performance/noAwaitInLoops: 轮询页面状态
      const s = await this.page.evaluate(() => {
        const all = document.querySelectorAll(
          '[data-testid="message-assistant"]'
        );
        return {
          busy: window.__demo ? window.__demo.busy() : true,
          count: all.length,
          retry: Boolean(
            document.querySelector('[data-testid="retry-notice"]')
          ),
          text: all.length > 0 ? all.item(all.length - 1).innerText : "",
        };
      });
      if (s.retry) {
        done({ error: "retry" });
        throw new Error(`${label}：这一轮出错了（页面上出现“重试”）`);
      }
      if (!s.busy && s.count > before) {
        if (s.text === lastText) {
          if (Date.now() - stableSince >= 1200) {
            break;
          }
        } else {
          lastText = s.text;
          stableSince = Date.now();
        }
      } else {
        lastText = null;
      }
      if (Date.now() > until) {
        done({ error: "timeout" });
        throw new Error(
          `${label}：等了 ${REPLY_TIMEOUT / 1000} 秒导师还没回完`
        );
      }
      await sleep(250);
    }
    done();
    await this.dumpTutor(label);
  }

  // 在平时的输入框里问一句
  async send(text, label) {
    const input = this.page.getByTestId("multimodal-input");
    if (!(await this.visible(input))) {
      throw new Error(`${label}：输入框不在（底部是检查题作答区？）`);
    }
    const before = await this.assistantCount();
    await this.actor.type(input, text, "输入框");
    await this.actor.click(this.page.getByTestId("send-button"), {
      after: 200,
      label: "发送",
    });
    await this.waitReply(label, before);
  }

  async cardPending() {
    return await this.visible(this.page.getByTestId("check-answer"));
  }

  // 在检查题作答区写答案、选把握、交卷；返回这一轮的判分条文字
  async answerCard(text, confidence, label) {
    const box = this.page.getByTestId("check-answer");
    await box.waitFor({ state: "visible", timeout: 15_000 });
    const before = await this.assistantCount();
    await this.actor.type(box, text, "作答框");
    const pick = this.page.getByTestId(`confidence-${confidence}`);
    if (await this.visible(pick)) {
      await this.actor.click(pick, {
        after: 450,
        label: `把握：${confidence}`,
      });
      if ((await pick.getAttribute("aria-checked")) !== "true") {
        this.log.warn(`把握“${confidence}”没选上`);
      }
    } else {
      this.log.warn("这道题不问把握（摸底题？）");
    }
    await this.actor.click(this.page.getByTestId("check-submit"), {
      after: 200,
      label: "交卷",
    });
    await this.waitReply(label, before);
    return await this.textOf(this.lastAssistant().getByTestId("graded-line"));
  }

  // 有检查题就在作答区答，没有就在输入框里说
  async answer(text, confidence, label) {
    if (await this.cardPending()) {
      return {
        graded: await this.answerCard(text, confidence, label),
        mode: "card",
      };
    }
    await this.send(text, label);
    return {
      graded: await this.textOf(
        this.lastAssistant().getByTestId("graded-line")
      ),
      mode: "text",
    };
  }

  // 回复下的“我懂了，考我”：让导师直接出一道独立题
  async quizMe(label) {
    const button = this.lastAssistant()
      .getByTestId("follow-ups")
      .getByRole("button", { name: "我懂了，考我" });
    if (!(await this.visible(button))) {
      return false;
    }
    const before = await this.assistantCount();
    await this.actor.click(button, { after: 200, label: "我懂了，考我" });
    await this.waitReply(label, before);
    return true;
  }

  // 底部还挂着没答的题时，点“先不做题”把输入框换回来
  async ensureFreeInput(label, facts) {
    // biome-ignore lint/performance/noAwaitInLoops: 跳过一题等回复再看下一题
    for (let i = 0; i < 2 && (await this.cardPending()); i += 1) {
      const skip = this.page.getByTestId("quick-skip");
      const before = await this.assistantCount();
      await this.actor.click(skip, { after: 200, label: "先不做题" });
      await this.waitReply(`${label}-skip`, before);
      facts.warnings.push("底部还有没答的题，点了“先不做题”（这一步要剪掉）");
    }
  }

  async scrollToLast(testid, block = "nearest") {
    const target = this.lastAssistant().getByTestId(testid);
    if (await this.visible(target)) {
      await this.actor.scrollIntoView(target, { block });
      return target;
    }
    return null;
  }

  // 结束本次学习 → 等会后复核跑完（30–90 秒，等待会剪掉）
  async endSession(label) {
    const button = this.page.getByTestId("end-session");
    await this.actor.click(button, { after: 300, label: "结束本次学习" });
    const report = this.page.getByTestId("session-report");
    await report.waitFor({ state: "visible", timeout: 15_000 });
    const done = this.log.wait(`review.${label}`);
    await this.page
      .waitForFunction(
        () => {
          const el = document.querySelector('[data-testid="session-report"]');
          return Boolean(
            el &&
              (/复核完了/.test(el.innerText) ||
                el.querySelector(".text-red-600"))
          );
        },
        null,
        { polling: 500, timeout: REVIEW_TIMEOUT }
      )
      .catch(() => null);
    const text = (await report.innerText().catch(() => "")) ?? "";
    const ok = /复核完了/.test(text);
    const error = ok
      ? null
      : ((await this.textOf(report.locator(".text-red-600"))) ?? "超时");
    done({ ok });
    this.log.tutor(`${label} · 本次学习小结`, text);
    const concepts = await this.textOf(report.getByTestId("report-concepts"));
    return { concepts: concepts ?? "", error, ok, report };
  }

  async closeReport(report) {
    await this.actor.click(
      report.getByRole("button", { exact: true, name: "关闭" }),
      {
        after: 600,
        label: "关闭小结",
      }
    );
    await report.waitFor({ state: "hidden", timeout: 5000 }).catch(() => null);
  }

  async openPersonal() {
    await this.actor.click(this.page.getByTestId("open-personal"), {
      after: 300,
      label: "我的星图",
      scroll: false,
    });
    const panel = this.page.getByTestId("personal-panel");
    await panel.waitFor({ state: "visible", timeout: 10_000 });
    await panel
      .locator(".react-flow__node-point")
      .first()
      .waitFor({ state: "visible", timeout: 20_000 });
    await sleep(1200);
    return panel;
  }

  // 在我的星图里点一颗星（点在星心上：节点左边 16px 处），等右边详情换成它
  async clickStar(panel, re, label) {
    const node = panel
      .locator(".react-flow__node-point")
      .filter({ hasText: re })
      .first();
    await node.waitFor({ state: "visible", timeout: 15_000 });
    await this.actor.click(node, {
      after: 600,
      at: (b) => ({ x: b.x + 16, y: b.y + b.height / 2 }),
      label,
      scroll: false,
    });
    const name = panel.getByTestId("star-name");
    await name.waitFor({ state: "visible", timeout: 5000 });
    return await this.textOf(name);
  }

  // 详情里停一停：先看出处（凭什么），再看连线（有关系）
  async holdOnStarDetail(panel, label) {
    const detail = panel.getByTestId("star-detail");
    const evidence = detail.getByText("凭什么", { exact: true });
    if (await this.visible(evidence)) {
      await this.actor.hover(evidence, 4000, `${label}：出处`, { spread: 0.1 });
    }
    const links = detail.getByTestId("links");
    if (await this.visible(links)) {
      await this.actor.hover(links, 3000, `${label}：连线`, { spread: 0.1 });
    }
  }

  // 镜头里需要的“事实”：星图上那颗星现在什么样（接口查，和页面同一份数据）
  async starFacts(re) {
    const map = await this.site.personalMap();
    const star = findStar(map, re);
    if (!star) {
      return { linked: false, sessions: 0, star: null };
    }
    return {
      linked: linkedTo(star, DEADLOCK, map),
      sessions: sessionCount(star),
      star: {
        evidence: star.evidence.map((e) => ({
          at: e.at,
          chat: e.chat ?? null,
          quote: e.quote,
          sessionId: e.sessionId,
        })),
        light: star.light,
        links: star.links.map((l) => ({ label: l.label, name: l.name })),
        name: star.name,
      },
    };
  }

  async deadlock() {
    return await this.site.light(this.deadlockId);
  }

  // 鼠标移到右边星图里「死锁」那颗星旁边停一会（不点）
  async lookAtDeadlockStar(holdMs, label) {
    const star = this.page.getByTestId(`sky-star-${this.deadlockId}`);
    const drawer = await this.page.getByTestId("side-drawer").boundingBox();
    const box = await star.boundingBox().catch(() => null);
    if (
      !(box && drawer && box.x > drawer.x && box.x < drawer.x + drawer.width)
    ) {
      this.log.warn("右边星图里没找到「死锁」这颗星，鼠标就停在星图上");
      if (drawer) {
        await this.actor.moveTo({
          x: drawer.x + drawer.width / 2,
          y: drawer.y + drawer.height / 2,
        });
      }
      await sleep(holdMs);
      return;
    }
    await this.actor.moveTo({
      x: box.x + box.width / 2 + 22,
      y: box.y + box.height / 2 + 14,
    });
    this.log.mark("hold", { label, ms: holdMs });
    await sleep(holdMs);
  }

  // 右边侧拉框默认是“课件”，切到“我的图谱”（星图）
  async showGraphTab(human) {
    const tab = this.page.getByTestId("tab-graph");
    if (!(await this.visible(tab))) {
      return;
    }
    const pane = this.page.getByTestId("pane-graph");
    const hidden = /opacity-0/.test((await pane.getAttribute("class")) ?? "");
    if (!hidden) {
      return;
    }
    if (human) {
      await this.actor.click(tab, {
        after: 800,
        label: "我的图谱",
        scroll: false,
      });
    } else {
      await tab.click();
      await sleep(600);
    }
  }

  // 页面就绪：输入框或作答区在、右边星图在、字体加载完
  async waitReady() {
    await this.page
      .locator('[data-testid="multimodal-input"], [data-testid="check-answer"]')
      .first()
      .waitFor({ state: "visible", timeout: 45_000 });
    await this.page
      .getByTestId("learner-graph")
      .waitFor({ state: "attached", timeout: 30_000 });
    await this.page.evaluate(() => document.fonts.ready.then(() => true));
    await this.page
      .waitForLoadState("networkidle", { timeout: 8000 })
      .catch(() => null);
    await sleep(1500);
  }
}

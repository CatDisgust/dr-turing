import { sleep } from "./actor.mjs";
import { litAtLeast, PHILOSOPHERS } from "./checks.mjs";
import { REST } from "./director.mjs";

// 分镜 3–7 的操作脚本（分镜见 scripts/demo-video/README.md 里的链接）。每个镜头返回一份“事实”，
// checks.mjs 按它判这一条能不能用。学生要打的字都写死在这里

export const TEXT = {
  // 镜头 5：反例追问的正确回答
  counter:
    "不会。两个事务按同一个顺序加锁，等待绕不成圈，就不会死锁；只有互相等对方手里的锁、形成环，才会死锁。",
  q4: "加锁为什么会死锁？",
  q6: "操作系统课里的哲学家就餐问题，和这个是一回事吗？",
  q7: "死锁是怎么发生的？",
  q7b: "哲学家就餐里，按顺序拿筷子就能避免死锁吗？",
  // 镜头 5 的独立题、镜头 7 的复习题：对大多数死锁题都算对的说法
  robust:
    "死锁是两个事务各拿着一把锁、又在等对方手里的那把，互相等待形成一个圈，谁也走不动。避免办法是所有事务按同一个顺序加锁。",
  // 镜头 5：很确定却答错
  wrong: "还会。只要加了锁，就可能死锁。",
};

// 镜头 5 最多再答几道独立题等「死锁」半亮
const EXTRA_ROUNDS = 3;
// 镜头 7 复习题之后最多再答几题等全亮
const EXTRA_REVIEW = 2;

// 星图里找一块空地（不压在星、按钮上）让鼠标停
async function restPointInDrawer(d) {
  const drawer = await d.page.getByTestId("side-drawer").boundingBox();
  if (!drawer) {
    return { x: 1060, y: 380 };
  }
  const candidates = [];
  for (const fy of [0.45, 0.55, 0.35, 0.65]) {
    for (const fx of [0.42, 0.55, 0.3, 0.68]) {
      candidates.push({
        x: Math.round(drawer.x + drawer.width * fx),
        y: Math.round(drawer.y + 56 + (drawer.height - 56) * fy),
      });
    }
  }
  const free = await d.page.evaluate(
    (points) =>
      points.find((p) => {
        const el = document.elementFromPoint(p.x, p.y);
        return (
          el &&
          !el.closest('[data-testid^="sky-star-"], button, a, [role="button"]')
        );
      }) ?? null,
    candidates
  );
  return free ?? candidates[0];
}

export async function shot3(d) {
  const facts = { warnings: [] };
  const pane = d.page.getByTestId("pane-graph");
  facts.starMapVisible =
    (await d.visible(d.page.getByTestId("learner-graph"))) &&
    !/opacity-0/.test((await pane.getAttribute("class").catch(() => "")) ?? "");
  facts.lights = await d.site.lightCounts();
  facts.deadlockLight = (await d.deadlock()).light;
  await sleep(1200);
  // 视线移到右边星图，停住
  await d.actor.moveTo(await restPointInDrawer(d));
  d.log.mark("hold", { label: "镜头 3 星图", ms: 6000 });
  await sleep(3000);
  await d.screenshot("shot3-star-map");
  await sleep(3000);
  return facts;
}

export async function shot4(d) {
  const facts = { warnings: [] };
  const since = Date.now();
  await d.actor.moveTo(REST);
  await d.send(TEXT.q4, "镜头4-提问");
  await d.flushPageLog();
  facts.touched =
    d.log.lastEvent(
      (e) => e.type === "app" && e.name === "dr:node-touched",
      since
    )?.detail?.name ?? null;
  facts.lessonName = await d.textOf(d.page.getByTestId("lesson-name"));

  // 回复上方的来源标签：“从你会的「丢失更新」讲起”
  const reply = d.lastAssistant();
  const startFrom = reply.getByTestId("start-from");
  facts.startFrom = await d.textOf(startFrom);
  if (facts.startFrom) {
    await d.actor.scrollIntoView(reply.getByTestId("plan"), {
      block: "nearest",
    });
    await d.actor.hover(startFrom, 2500, "从你会的…讲起", { spread: 0.15 });
    await d.screenshot("shot4-start-from");
  }

  // 动手试试：T1、T2、T1、T2 各走一步，两个事务互相等住
  const sim = reply.getByTestId("deadlock-sim");
  facts.sim = await d.visible(sim);
  if (facts.sim) {
    await d.actor.scrollIntoView(sim, { block: "center" });
    await sleep(1200);
    for (const t of [1, 2, 1, 2]) {
      // biome-ignore lint/performance/noAwaitInLoops: 按顺序点
      await d.actor.click(sim.getByTestId(`sim-step-${t}`), {
        after: Math.round(d.actor.rng.range(900, 1300)),
        label: `T${t} 走一步`,
        scroll: false,
      });
    }
    const status = sim.getByTestId("sim-status");
    facts.simStatus = await d.textOf(status);
    await d.actor.hover(status, 2500, "模拟卡死了", {
      scroll: false,
      spread: 0.1,
    });
    await d.screenshot("shot4-sim-deadlock");
  }

  // 检查题卡片（第一条回复没带就点“我懂了，考我”）
  let card = d.lastAssistant().getByTestId("check-card");
  if (!(await d.visible(card)) && (await d.quizMe("镜头4-考我"))) {
    facts.usedQuizMe = true;
    card = d.lastAssistant().getByTestId("check-card");
  }
  facts.checkCard = await d.textOf(card);
  if (facts.checkCard) {
    await d.actor.hover(card, 3000, "检查题", { spread: 0.15 });
    await d.screenshot("shot4-check-card");
  }
  return facts;
}

export async function shot5(d) {
  const facts = { warnings: [] };
  // 很确定，但答错
  facts.graded = await d.answerCard(TEXT.wrong, "sure", "镜头5-答错");
  const line = await d.scrollToLast("graded-line");
  if (line) {
    await d.actor.hover(line, 2500, "以为学会了", {
      scroll: false,
      spread: 0.1,
    });
    await d.screenshot("shot5-graded-wrong");
  }

  // 导师拿反例追问：答对
  await d.actor.moveTo(REST);
  facts.counter = await d.answer(TEXT.counter, "somewhat", "镜头5-反例");
  d.log.mark("counterexample", facts.counter);

  // 再独立答对，直到「死锁」半亮（最多 3 道）
  facts.rounds = 0;
  let quizzes = 0;
  let state = await d.deadlock();
  while (!litAtLeast(state.light, "half") && facts.rounds < EXTRA_ROUNDS) {
    // biome-ignore lint/performance/noAwaitInLoops: 一题一题答
    if (await d.cardPending()) {
      facts.rounds += 1;
      const graded = await d.answerCard(
        TEXT.robust,
        "sure",
        `镜头5-独立题${facts.rounds}`
      );
      d.log.mark("independent", { graded, round: facts.rounds });
    } else if (
      quizzes < EXTRA_ROUNDS &&
      (await d.quizMe(`镜头5-考我${quizzes + 1}`))
    ) {
      quizzes += 1;
      facts.warnings.push("点了“我懂了，考我”才出独立题");
    } else {
      break;
    }
    await sleep(800);
    state = await d.deadlock();
  }
  facts.deadlock = { M: state.M, O: state.O };
  facts.deadlockLight = state.light;
  d.log.mark("deadlock.light", { ...state, shot: 5 });
  if (litAtLeast(state.light, "half")) {
    const line2 = await d.scrollToLast("graded-line");
    if (line2) {
      await d.actor.hover(line2, 1500, "独立答对", {
        scroll: false,
        spread: 0.1,
      });
    }
    await d.lookAtDeadlockStar(3000, "「死锁」半亮");
    await d.screenshot("shot5-deadlock-half");
  }
  return facts;
}

// 镜头 6、7 共用：结束学习 → 小结 → 我的星图 → 点「哲学家就餐」
async function endAndOpenStar(d, label, facts) {
  const review = await d.endSession(label);
  facts.reportOk = review.ok;
  facts.reportError = review.error;
  facts.reportConcepts = review.concepts;
  if (review.ok) {
    await sleep(1000);
    await d.screenshot(`${label}-report`);
    await d.actor.hover(review.report, 2500, "本次学习小结", {
      scroll: false,
      spread: 0.3,
    });
  }
  await d.closeReport(review.report);
  const panel = await d.openPersonal();
  await sleep(1500);
  const name = await d
    .clickStar(panel, PHILOSOPHERS, "哲学家就餐")
    .catch((error) => {
      facts.warnings.push(`没点到「哲学家就餐」：${error.message}`);
      return null;
    });
  d.log.mark("star", { name });
  if (name) {
    await d.holdOnStarDetail(panel, "哲学家就餐");
    await d.screenshot(`${label}-philosophers`);
  }
  const star = await d.starFacts(PHILOSOPHERS);
  facts.philo = star.star;
  facts.linkedToDeadlock = star.linked;
  facts.philoSessions = star.sessions;
  await sleep(1500);
}

export async function shot6(d) {
  const facts = { warnings: [] };
  await d.ensureFreeInput("镜头6", facts);
  await d.actor.moveTo(REST);
  await d.send(TEXT.q6, "镜头6-课外追问");
  await sleep(2000);
  await endAndOpenStar(d, "shot6", facts);
  return facts;
}

// 镜头 6 → 7 之间：模拟第二天（新对话之前调用）
export async function nextDay(d) {
  const done = d.log.wait("next-day");
  const { used, result } = await d.site.nextDay();
  done({ used });
  d.log.mark("nextday", { result, used });
  return used;
}

export async function shot7(d, { site }) {
  const facts = { warnings: [] };
  facts.nextDay = await nextDay(d);
  // 新对话：重新打开首页（这一下会剪掉，画面角落标“模拟第二天”）
  await d.flushPageLog();
  await d.page.goto(`${site}/`, { waitUntil: "domcontentloaded" });
  d.dumped = 0;
  await d.waitReady();
  await d.showGraphTab(true);
  await d.actor.moveTo(REST);
  await sleep(1000);

  await d.send(TEXT.q7, "镜头7-再问死锁");
  let card = d.lastAssistant().getByTestId("check-card");
  facts.firstCard = await d.textOf(card);
  const plan = await d.textOf(
    d.lastAssistant().getByTestId("plan").locator("summary")
  );
  facts.reviewFirst = Boolean(
    (facts.firstCard && /复习题/.test(facts.firstCard)) ||
      (plan && /复习/.test(plan))
  );
  if (!facts.firstCard && (await d.quizMe("镜头7-考我"))) {
    facts.warnings.push("导师没出题，点了“我懂了，考我”");
    card = d.lastAssistant().getByTestId("check-card");
  }
  if (await d.visible(card)) {
    await d.actor.hover(card, 2000, "复习题", { spread: 0.15 });
  }

  // 不看提示、很确定、答对
  facts.graded = await d.answerCard(TEXT.robust, "sure", "镜头7-复习题");
  const line = await d.scrollToLast("graded-line");
  if (line) {
    await d.actor.hover(line, 2000, "答对了", { scroll: false, spread: 0.1 });
  }
  let state = await d.deadlock();
  facts.extraAnswers = 0;
  while (state.light !== "full" && facts.extraAnswers < EXTRA_REVIEW) {
    // biome-ignore lint/performance/noAwaitInLoops: 一题一题答
    if (!(await d.cardPending())) {
      break;
    }
    facts.extraAnswers += 1;
    await d.answerCard(TEXT.robust, "sure", `镜头7-再答${facts.extraAnswers}`);
    await sleep(800);
    state = await d.deadlock();
  }
  facts.deadlock = { M: state.M, O: state.O };
  facts.deadlockLight = state.light;
  d.log.mark("deadlock.light", { ...state, shot: 7 });
  await d.lookAtDeadlockStar(
    3000,
    state.light === "full" ? "「死锁」全亮" : "「死锁」"
  );
  await d.screenshot("shot7-deadlock");

  // 又聊到哲学家就餐 → 结束 → 我的星图：那颗星亮了，出处两次对话
  await d.ensureFreeInput("镜头7", facts);
  await d.actor.moveTo(REST);
  await d.send(TEXT.q7b, "镜头7-哲学家就餐");
  await sleep(2000);
  await endAndOpenStar(d, "shot7", facts);
  return facts;
}

export const SHOT_SCRIPTS = {
  3: shot3,
  4: shot4,
  5: shot5,
  6: shot6,
  7: shot7,
};

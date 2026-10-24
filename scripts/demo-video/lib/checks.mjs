// 自动筛选：每个镜头录完收集一份“事实”（页面上看到的、接口查到的），这里按分镜判能不能用。
// 纯函数，test/checks.test.mjs 有单测

export const SHOTS = [3, 4, 5, 6, 7];

// 和 lib/learner/config.ts、lib/learner/light.ts 一致：全亮 O ≥ 0.7，半亮 M ≥ 0.6
export const HALF_M = 0.6;
export const FULL_O = 0.7;

export function lightOf(node) {
  if (!node) {
    return "gray";
  }
  if ((node.O ?? 0) >= FULL_O) {
    return "full";
  }
  if ((node.M ?? 0) >= HALF_M) {
    return "half";
  }
  return "gray";
}

export const LIGHT_RANK = { dashed: 1, full: 3, gray: 0, half: 2 };
export const litAtLeast = (light, min) =>
  (LIGHT_RANK[light] ?? 0) >= LIGHT_RANK[min];

// 和 lib/demo/seed.ts 的 demoTarget 一样：先按名字找，再按别名找
export const DEADLOCK = /死锁|deadlock/i;
const START_FROM = /悲观并发控制|加锁/;
export const PHILOSOPHERS = /哲学家/;

export function findPoint(graph, re) {
  const points = graph?.points ?? [];
  return (
    points.find((p) => re.test(p.name)) ??
    points.find((p) => (p.aliases ?? []).some((a) => re.test(a))) ??
    null
  );
}

// 我的星图（/api/personal/map）里找一颗星，课外概念优先
export function findStar(map, re) {
  const stars = Object.values(map?.stars ?? {});
  const hits = stars.filter(
    (s) => re.test(s.name) || (s.aliases ?? []).some((a) => re.test(a))
  );
  return hits.find((s) => s.kind === "outside") ?? hits[0] ?? null;
}

// 星的出处来自几次不同的对话
export const sessionCount = (star) =>
  new Set((star?.evidence ?? []).map((e) => e.sessionId).filter(Boolean)).size;

export function linkedTo(star, re, map) {
  if (!star) {
    return false;
  }
  if ((star.links ?? []).some((l) => re.test(l.name ?? ""))) {
    return true;
  }
  return (star.related ?? []).some((id) =>
    re.test(map?.stars?.[id]?.name ?? "")
  );
}

const has = (text, re) => typeof text === "string" && re.test(text);

// 每个镜头的判定。reasons 不为空就算不能用；warnings 只提醒，不影响 pass
export function verdictFor(shot, f = {}) {
  const reasons = [];
  const warnings = [...(f.warnings ?? [])];
  const need = (ok, reason) => {
    if (!ok) {
      reasons.push(reason);
    }
  };
  if (f.error) {
    reasons.push(`出错：${f.error}`);
  }
  switch (shot) {
    case 3:
      need(f.starMapVisible, "右边没看到星图");
      need((f.lights?.full ?? 0) > 0, "星图上没有全亮的星（预置起点不对？）");
      need((f.lights?.half ?? 0) > 0, "星图上没有半亮的星（预置起点不对？）");
      if (f.deadlockLight && f.deadlockLight !== "gray") {
        warnings.push(
          `开录前「死锁」已经是 ${f.deadlockLight}，后面的点亮就不明显了`
        );
      }
      break;
    case 4:
      need(
        has(f.touched, DEADLOCK),
        `问题归到了「${f.touched ?? "无"}」，不是死锁`
      );
      // 图谱里「死锁」的前置是「悲观并发控制（加锁）」（seed.ts，用户 2026-10-22 定），预置学生已经会它
      need(
        has(f.startFrom, START_FROM),
        `标签不是“从你会的「悲观并发控制（加锁）」讲起”（实际：${f.startFrom ?? "没有标签"}）`
      );
      need(f.sim, "没有出死锁模拟");
      need(
        !f.sim || has(f.simStatus, /卡死|死锁/),
        `模拟没有卡死（状态：${f.simStatus ?? "无"}）`
      );
      need(Boolean(f.checkCard), "没有出检查题卡片");
      if (f.usedQuizMe) {
        warnings.push(
          "第一条回复没带检查题，点了“我懂了，考我”才出题（这一步要剪掉）"
        );
      }
      if (!f.lessonName) {
        warnings.push("顶栏没显示本课进度");
      }
      // 模拟和检查题里 A、B 是锁，T1、T2 是事务；讲解要是把事务叫成 A、B，观众会搞混
      if (/事务\s*[AB](?![a-z])/i.test(f.replyText ?? "")) {
        warnings.push(
          "讲解里把事务叫成了 A/B，和模拟里的锁 A、锁 B 撞名（挑别的 take）"
        );
      }
      break;
    case 5:
      need(
        has(f.graded, /以为学会了/),
        `红条里没有“以为学会了”（实际：${f.graded ?? "没有判分条"}）`
      );
      need(
        litAtLeast(f.deadlockLight, "half"),
        `「死锁」没有半亮（${f.deadlockLight ?? "未知"}，M=${fmt(f.deadlock?.M)}）`
      );
      if (f.counter && !has(f.counter.graded, /答对/)) {
        warnings.push(
          `反例追问那一题没判对（${f.counter.graded ?? f.counter.mode ?? "没有判分条"}）`
        );
      }
      break;
    case 6:
      need(
        f.reportOk,
        `会话报告没出来${f.reportError ? `：${f.reportError}` : ""}`
      );
      need(Boolean(f.philo), "我的星图里没有「哲学家就餐」这颗星");
      need(
        !f.philo || f.philo.light === "gray",
        `「哲学家就餐」不是暗星（${f.philo?.light}）`
      );
      need(!f.philo || f.linkedToDeadlock, "「哲学家就餐」没有连到「死锁」");
      need(
        !f.philo ||
          (f.philo.evidence ?? []).some((e) =>
            PHILOSOPHERS.test(e.quote ?? "")
          ),
        "「哲学家就餐」的出处里没有刚才那句原话"
      );
      if (
        f.reportConcepts !== undefined &&
        !has(f.reportConcepts, PHILOSOPHERS)
      ) {
        warnings.push("会话报告的“个人图谱”里没写新增「哲学家就餐」");
      }
      break;
    case 7:
      need(f.nextDay, "没写入“第二天”");
      need(
        f.reviewFirst,
        `导师没有先出复习题（第一张卡：${f.firstCard ?? "没有"}）`
      );
      need(
        f.deadlockLight === "full",
        `「死锁」没有全亮（${f.deadlockLight ?? "未知"}，O=${fmt(f.deadlock?.O)}）`
      );
      need(
        f.reportOk,
        `会话报告没出来${f.reportError ? `：${f.reportError}` : ""}`
      );
      need(Boolean(f.philo), "我的星图里没有「哲学家就餐」这颗星");
      need(
        f.philo?.light !== "gray",
        `「哲学家就餐」没有亮起来（${f.philo?.light}）`
      );
      need(
        !f.philo || f.philoSessions >= 2,
        `「哲学家就餐」的出处不到两次对话（${f.philoSessions ?? 0}）`
      );
      if (f.extraAnswers > 0) {
        warnings.push(`复习题之后又答了 ${f.extraAnswers} 题才全亮`);
      }
      break;
    default:
      break;
  }
  return { pass: reasons.length === 0, reasons, warnings };
}

const fmt = (x) => (typeof x === "number" ? x.toFixed(2) : "?");

export const snapshotName = (shot) => `after-shot-${shot}`;

// 命令行参数
export function parseArgs(argv) {
  const opts = {
    capture: "window",
    fromShot: 3,
    help: false,
    obs: true,
    seed: "drturing",
    snapshots: true,
    takes: 1,
    toShot: 7,
  };
  const value = (i) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) {
      throw new Error(`${argv[i]} 后面要跟一个值`);
    }
    return v;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--takes") {
      opts.takes = Number(value(i));
      i += 1;
    } else if (a === "--from-shot") {
      opts.fromShot = Number(value(i));
      i += 1;
    } else if (a === "--to-shot") {
      opts.toShot = Number(value(i));
      i += 1;
    } else if (a === "--shot") {
      opts.fromShot = Number(value(i));
      opts.toShot = opts.fromShot;
      i += 1;
    } else if (a === "--seed") {
      opts.seed = value(i);
      i += 1;
    } else if (a === "--obs-capture") {
      opts.capture = value(i);
      i += 1;
    } else if (a === "--no-obs") {
      opts.obs = false;
    } else if (a === "--no-snapshots") {
      opts.snapshots = false;
    } else if (a === "--help" || a === "-h") {
      opts.help = true;
    } else {
      throw new Error(`不认识的参数：${a}`);
    }
  }
  if (!(Number.isInteger(opts.takes) && opts.takes >= 1)) {
    throw new Error("--takes 要是正整数");
  }
  if (!(SHOTS.includes(opts.fromShot) && SHOTS.includes(opts.toShot))) {
    throw new Error(`镜头只能是 ${SHOTS.join("、")}`);
  }
  if (opts.fromShot > opts.toShot) {
    throw new Error("--from-shot 不能大于 --to-shot");
  }
  if (!["window", "display"].includes(opts.capture)) {
    throw new Error("--obs-capture 只能是 window 或 display");
  }
  return opts;
}

// 最后打印的汇总表：每条一行，每个镜头 PASS / FAIL / ERR / skip，没录的是 -
export function summaryTable(takes) {
  const head = ["take", ...SHOTS.map((s) => `shot${s}`), "video"];
  const rows = takes.map((t) => [
    t.id,
    ...SHOTS.map((s) => {
      const v = t.verdict?.[s];
      if (!v) {
        return "-";
      }
      if (v.skipped) {
        return "skip";
      }
      if (v.error) {
        return "ERR";
      }
      return v.pass ? "PASS" : "FAIL";
    }),
    t.video ?? "(no video)",
  ]);
  const widths = head.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i]).length))
  );
  const line = (cells) =>
    cells
      .map((c, i) => String(c).padEnd(widths[i]))
      .join("  ")
      .trimEnd();
  return [line(head), ...rows.map(line)].join("\n");
}

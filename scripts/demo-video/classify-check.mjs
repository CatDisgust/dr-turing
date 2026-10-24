// 归类稳不稳：同一句话问 N 次，看几次归到「死锁」。node classify-check.mjs [--runs 20] [--concurrency 3]
// 先试 /api/eval/classify?question=…（现在它只跑评测集里的第 index 条，不收任意问题；以后加了 question 参数就自动用它）；
// 不支持就用 /api/demo/compare：它对任意一句话先归类，返回 target（顺带给学生 A、B 各出一份规划，不改任何人的状态，
// 但每次要多调两次 Claude，慢一些）。compare 要先在 /compare 写入过预置数据，否则返回 409

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEADLOCK, findPoint } from "./lib/checks.mjs";

const SITE = (process.env.SITE ?? "https://dr-turing-81so.vercel.app").replace(
  /\/+$/,
  ""
);
const COURSE_ID = process.env.COURSE_ID ?? "comp5348";
const QUESTIONS = ["加锁为什么会死锁？", "死锁是怎么发生的？"];

function option(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
}

async function json(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  try {
    return { body: JSON.parse(text), status: response.status };
  } catch {
    return { body: null, status: response.status, text: text.slice(0, 200) };
  }
}

// 返回 undefined 表示这个接口不收任意问题
async function viaEval(question) {
  const { body, status } = await json(
    `${SITE}/api/eval/classify?question=${encodeURIComponent(question)}&index=-1`
  );
  if (status !== 200 || body?.question !== question || !("got" in body)) {
    return;
  }
  return body.got;
}

async function viaCompare(question) {
  const { body, status, text } = await json(`${SITE}/api/demo/compare`, {
    body: JSON.stringify({ courseId: COURSE_ID, question, runs: 1 }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (status === 409) {
    throw new Error(
      "compare 要先写入学生 A、B 的预置数据：在 /compare 页面点“写入预置数据”（注意它也会把「演示学生」重置成预置起点）"
    );
  }
  if (status === 422) {
    return null;
  }
  if (status !== 200) {
    throw new Error(`compare 失败（${status}）：${body?.error ?? text}`);
  }
  return body.target?.name ?? null;
}

async function pool(n, concurrency, task) {
  const results = new Array(n);
  let next = 0;
  const worker = async () => {
    while (next < n) {
      const i = next;
      next += 1;
      try {
        // biome-ignore lint/performance/noAwaitInLoops: 每个 worker 一次只发一个请求，控制并发
        results[i] = { name: await task(i) };
      } catch (error) {
        results[i] = { error: error.message };
      }
      process.stdout.write(".");
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  process.stdout.write("\n");
  return results;
}

async function main() {
  const runs = option("runs", 20);
  const concurrency = option("concurrency", 3);
  const course = await json(`${SITE}/api/course/${COURSE_ID}`);
  const target = findPoint(course.body?.graph, DEADLOCK);
  if (!target) {
    throw new Error(
      `课程 ${COURSE_ID} 的图谱里找不到「死锁」（${course.status}）`
    );
  }
  const mode = (await viaEval(QUESTIONS[0])) === undefined ? "compare" : "eval";
  console.log(
    `站点 ${SITE}，课程 ${COURSE_ID}，目标「${target.name}」，用 ${mode === "eval" ? "/api/eval/classify" : "/api/demo/compare"}，每句 ${runs} 次`
  );
  const report = {
    at: new Date().toISOString(),
    mode,
    questions: [],
    site: SITE,
    target: target.name,
  };
  for (const question of QUESTIONS) {
    console.log(`\n「${question}」`);
    // biome-ignore lint/performance/noAwaitInLoops: 一句问完再问下一句
    const results = await pool(runs, concurrency, () =>
      mode === "eval"
        ? viaEval(question).then((got) => got ?? null)
        : viaCompare(question)
    );
    const counts = {};
    for (const r of results) {
      const key = r.error ? `出错：${r.error}` : (r.name ?? "（没归到任何点）");
      counts[key] = (counts[key] ?? 0) + 1;
    }
    const hits = results.filter((r) => r.name === target.name).length;
    for (const [name, n] of Object.entries(counts).toSorted(
      (a, b) => b[1] - a[1]
    )) {
      console.log(`  ${String(n).padStart(3)} × ${name}`);
    }
    console.log(
      `  → ${hits}/${runs} 次归到「${target.name}」（${Math.round((hits / runs) * 100)}%）`
    );
    report.questions.push({ counts, hits, question, runs });
  }
  const out = resolve(dirname(fileURLToPath(import.meta.url)), "out");
  mkdirSync(out, { recursive: true });
  const file = join(out, `classify-${Date.now()}.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n结果写在 ${file}`);
}

await main();

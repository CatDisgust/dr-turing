import { config } from "dotenv";
import { asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { event, transaction } from "../lib/db/schema";
import { BKT } from "../lib/learner/config";
import {
  calibrate,
  replayScores,
  reviewedAttempts,
} from "../lib/learner/predict";

// 离线验证（学生建模方案 D）：读已有的作答和事件，按学生看两件事：
// 1. 模型出题时的预测准不准，和所有人共用参数（对照组）比；
// 2. 只用作答记录从头重放，换一个学习率 ℓ 会不会更准（个人化 ℓ 做好后用来比）。
// 用法：pnpm replay-eval [要比的学习率，默认 0.25]

config({ path: ".env.local" });

const fixed = (x: number) => x.toFixed(3);

async function main() {
  if (!process.env.POSTGRES_URL) {
    console.log("POSTGRES_URL 没配置");
    process.exit(1);
  }
  const other = Number(process.argv[2] ?? 0.25);
  const connection = postgres(process.env.POSTGRES_URL, { max: 1 });
  const db = drizzle(connection);
  const transactions = await db
    .select()
    .from(transaction)
    .orderBy(asc(transaction.createdAt));
  const events = await db.select().from(event).orderBy(asc(event.at));
  await connection.end();

  console.log(
    `学生\t核对题数\t猜对方向\tlog loss 模型/对照\tBrier 模型/对照\t重放题数\tlog loss ℓ=${BKT.learn}/ℓ=${other}`
  );
  for (const studentId of new Set(transactions.map((t) => t.studentId))) {
    const rows = reviewedAttempts(
      transactions.filter((t) => t.studentId === studentId),
      events.filter((e) => e.studentId === studentId)
    );
    const c = calibrate(rows);
    const replay = replayScores(rows, [BKT.learn, other]);
    console.log(
      [
        studentId.slice(0, 8),
        c?.n ?? 0,
        c ? `${c.hits}/${c.n}` : "-",
        c ? `${fixed(c.logLoss)} / ${fixed(c.baseline.logLoss)}` : "-",
        c ? `${fixed(c.brier)} / ${fixed(c.baseline.brier)}` : "-",
        replay.n,
        replay.byLearn.map((r) => fixed(r.logLoss)).join(" / ") || "-",
      ].join("\t")
    );
  }
}

main();

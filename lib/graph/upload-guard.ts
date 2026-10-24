import "server-only";
import { countOwnCourses, getSpend } from "@/lib/db/queries";
import { uploadBlock } from "@/lib/own-course";
import type { Session } from "@/lib/session";

// 试用账号生成自己的课之前查一遍：额度、课数、生成次数。管理员不限
export async function trialUploadBlock(session: Session) {
  if (!session.invite) {
    return null;
  }
  const [own, spent] = await Promise.all([
    countOwnCourses(session.user.id),
    getSpend(session.user.id),
  ]);
  return uploadBlock({
    budgetCents: session.invite.budgetCents,
    courseLimit: session.invite.courseLimit,
    generations: session.invite.generations,
    own,
    spentMicroUsd: spent,
  });
}

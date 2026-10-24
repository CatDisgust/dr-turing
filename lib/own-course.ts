// 学生自己传课（第 4 步，2026-10-24 评审文档的默认做法）：谁能看、能传多少。
// 只放不碰数据库的规则，路由和页面共用

// 防烧钱：每个文件、每门课、每个账号的上限
export const OWN_LIMITS = {
  fileMb: 20,
  generations: 4,
  lessons: 15,
  pages: 80,
};

// 公开课（管理员加的）大家都能看；私人课只有传课的人自己能看，管理员也不看内容
export function canSeeCourse(
  course: { ownerId: string | null },
  viewerId: string
) {
  return course.ownerId === null || course.ownerId === viewerId;
}

// 试用账号还能不能再传一门课；能就返回 null，不能就返回给学生看的一句话
export function uploadBlock({
  own,
  courseLimit,
  generations,
  spentMicroUsd,
  budgetCents,
}: {
  own: number;
  courseLimit: number;
  generations: number;
  spentMicroUsd: number;
  budgetCents: number;
}): string | null {
  if (spentMicroUsd >= budgetCents * 10_000) {
    return "试用额度用完了，传不了新课。跟给你邀请码的人说一声，加一点额度就行。";
  }
  if (own >= courseLimit) {
    return `你已经有 ${own} 门自己的课了，最多 ${courseLimit} 门。删掉一门再传。`;
  }
  if (generations >= OWN_LIMITS.generations) {
    return `自己传课最多生成 ${OWN_LIMITS.generations} 次（删了再传也算），已经用完了。`;
  }
  return null;
}

// 一份课件能不能用：太大、页数太多就不收
export function fileBlock(bytes: number, pages?: number): string | null {
  if (bytes > OWN_LIMITS.fileMb * 1024 * 1024) {
    return `这份课件超过 ${OWN_LIMITS.fileMb}MB 了，拆小一点再传。`;
  }
  if (pages !== undefined && pages > OWN_LIMITS.pages) {
    return `这份课件有 ${pages} 页，一课最多 ${OWN_LIMITS.pages} 页，拆成几课再传。`;
  }
  return null;
}

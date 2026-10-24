// 新课的 id：课名里的字母数字做前缀（好认），后面 4 位随机，免得和已有的课撞上覆盖掉
const CHARS = "abcdefghjkmnpqrstuvwxyz23456789";

export function makeCourseId(name: string, random: () => number = Math.random) {
  const prefix = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 10);
  let tail = "";
  for (let i = 0; i < 4; i += 1) {
    tail += CHARS.charAt(Math.floor(random() * CHARS.length));
  }
  return `${prefix || "course"}-${tail}`;
}

// 消息里给模型和复核看的文字：文字块原样，检查题卡片还原成一句“检查一下：题面”。
// 卡片以前就是这句文字，导师和复核要知道当时出了什么题
export function partText(part: unknown): string {
  if (!part || typeof part !== "object") {
    return "";
  }
  const { type } = part as { type?: unknown };
  if (type === "text" && "text" in part) {
    return String((part as { text: unknown }).text);
  }
  if (type === "data-check" && "data" in part) {
    const { question } = (part as { data: { question?: unknown } }).data;
    return typeof question === "string" ? `\n\n**检查一下：**${question}` : "";
  }
  return "";
}

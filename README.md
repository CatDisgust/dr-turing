# Dr.Turing

让理解自然发生。带学生记忆的学习助手 demo。

基于 [vercel/ai-chatbot](https://github.com/vercel/ai-chatbot)（Apache-2.0）改造：去掉登录和模型选择器，所有模型调用改走 Anthropic API。讲解准则来自 [Aha v0.2.0](https://github.com/CatDisgust/aha-skill)（MIT），原文在 `lib/tutor/prompts/aha-SKILL.md`。

## 本地运行

```bash
pnpm install
cp .env.example .env.local   # 填 ANTHROPIC_API_KEY 和 POSTGRES_URL
pnpm db:migrate
pnpm dev
```

## 代码在哪

- `lib/claude.ts`：Anthropic 客户端、模型和 effort 档位，改一处全局生效
- `lib/tutor/`：讲解链路（提示词、Anthropic 流转成 UI 流）
- `lib/session.ts`：没有登录，固定一个演示学生；以后换成学生 A / B 切换
- `app/(chat)/api/chat/route.ts`：每轮对话的入口

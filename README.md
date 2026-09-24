# Chat Relationship Analyzer

把符合当前支持格式的微信桌面端双人聊天粘贴到浏览器中，先在本地解析和确认参与者，再分两阶段生成关系场景匹配、互动信号与关系解读。

> Paste a conversation. See the interaction patterns.

本产品分析当前聊天片段中可观察到的互动模式，不确认现实关系身份、不读取真实内心、不测量真实好感概率，也不提供心理诊断或关系行动建议。

## 本地开发

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

环境变量说明见 `.env.example`。API Key 只允许存在于服务端环境变量中；`ANALYSIS_CONTEXT_SECRET` 必须使用独立的高强度随机值，不能复用任何上游密钥。

## 质量检查

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
```

自动化测试统一 mock JEV 与 LLM，不访问真实第三方服务。Playwright 只使用人工虚构聊天内容。

## 隐私边界

- 浏览器在用户确认前只做本地解析，不产生外部模型费用。
- 服务端只在单次请求内存中处理聊天，不写入数据库、文件、缓存、队列或日志。
- 用户确认后，消息正文会发送到 TypeSafe 和 DeepSeek，第三方处理与留存遵循各自条款。
- 关系解读只解释已签名的互动分析结果，不能重新分类或评分。

产品范围与业务边界见 `AGENTS.md`，技术契约与实现说明见 `SYSTEM_DESIGN.md`。

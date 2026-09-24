# Chat Relationship Analyzer — System Design

> 本文档面向工程师和编码 Agent，记录系统架构、接口契约、数据结构、算法、安全约束、代码划分和验证方案。产品范围、用户流程和业务边界以 `AGENTS.md` 为准。

## 1. 技术栈

| 部分 | 选择 | 约束 |
|---|---|---|
| 框架 | Next.js App Router + TypeScript | 前后端同仓库 |
| 包管理器 | pnpm | 不混用 npm/yarn lockfile |
| 样式 | Tailwind CSS v4 | 使用 CSS 变量承载设计令牌 |
| UI 基础 | shadcn/ui + Lucide Icons | 只引入实际使用的组件 |
| 数据校验 | Zod v4 | 所有外部输入与模型输出都校验 |
| JEV | 服务端原生 `fetch` | 不额外引入 TypeSafe SDK |
| LLM | DeepSeek `deepseek-flash` + `openai` npm SDK | 使用 DeepSeek 的 OpenAI 兼容 Chat Completions 接口 |
| 状态管理 | React 本地状态 | MVP 不引入 Redux/Zustand |
| 测试 | Vitest + Playwright | parser、评分逻辑和主流程优先 |
| 部署 | Vercel | API Route 使用 Node.js runtime |

API Key 只能存在于服务端环境变量中。不得通过 `NEXT_PUBLIC_*`、HTML、客户端 bundle、日志或错误信息泄漏密钥。

### 环境变量

```env
TYPESAFE_API_KEY=
TYPESAFE_MODEL=jev-1.13.0

LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=
LLM_MODEL=deepseek-flash

ANALYSIS_CONTEXT_SECRET=
```

- JEV 锁定经过评测的具体版本，不直接使用会漂移的 `jev-latest`。
- “OpenAI 格式”在 MVP 中专指 `openai` SDK 的 Chat Completions 调用能力，不宣称 DeepSeek 兼容所有 OpenAI API 功能。
- 并非所有兼容服务都支持 JSON Schema；实现必须使用 Zod 校验，并允许一次受控的格式修复重试。
- `ANALYSIS_CONTEXT_SECRET` 是独立的服务端随机密钥，只用于签名两步分析之间的短时上下文，不得复用任何上游 API Key，也不得暴露给客户端。
- 分析维度、权重和置信度阈值由 `src/server/analysis/ruleset.ts` 中的版本化规则集统一定义。每次改变规则语义或计算方式时必须更新 `ANALYSIS_RULESET_VERSION`，不得通过散落的环境变量临时覆盖。
- 解释层的输出结构、解释边界或 Prompt 语义发生变化时必须更新 `EXPLANATION_POLICY_VERSION`；纯措辞修正且不改变解释语义时不升版。两个版本都由代码常量定义，不使用环境变量覆盖。

## 2. 系统架构与请求边界

```text
用户粘贴聊天
  → 浏览器本地解析和预览
  → 用户按解析出的昵称明确选择 A 或 B 哪位是“我”
  → 页面展示第三方处理提示，用户确认提交
  → POST /api/analyze/signals（提交结构化消息）
  → 服务端 Zod 校验、计算确定性指标
  → JEV 请求 1：主导关系场景 Choice + 多维度 Score
  → 符合条件时，JEV 请求 2：所选大类的细分 Choice；失败时仅将细分标记为暂时不可用
  → 服务端计算互动平衡度与综合互动指数，并应用置信度规则
  → 返回 JEV 结果和服务端签名的分析上下文，页面立即展示关系场景匹配与互动分析
  → POST /api/analyze/explanation（重新提交结构化消息和签名分析上下文）
  → 服务端重新校验消息，并验证签名、有效期、参与者、消息摘要、分析规则集版本及解释策略版本
  → LLM 根据已经验证的 JEV 决策及置信度生成关系解释
  → 服务端校验证据消息 ID，页面补充展示关系解读
```

### 请求边界

- 服务端不信任客户端统计值；`/api/analyze/signals` 必须根据结构化消息计算消息数量、参与比例等确定性指标。
- 解析和预览只在浏览器本地完成，预览结果只读；用户确认第三方处理提示并提交前，不得调用 JEV 或 LLM。
- 解析器按有效消息中发送者首次出现的顺序分配 A、B；浏览器的 `meId` 初始为未选择，用户在预览中选择后才生成 `participants.meId` / `otherId` 并允许提交。身份选择只改变角色映射，不改写消息的 `senderId`。
- JEV 分析与 LLM 解释拆成两个普通 JSON 请求；第一个请求完成后立即展示 JEV 结果，随后自动发起第二个请求生成关系解读。
- 前端不能把可编辑的 JEV 分数直接提交给 LLM。第一个接口返回短时有效、带服务端签名的分析上下文；第二个接口必须验证签名、有效期、参与者、消息摘要、`analysisRulesetVersion` 和 `explanationPolicyVersion`，验证通过后才能使用其中的 JEV 结果。
- 签名分析上下文不包含聊天正文，只包含服务端确认的确定性指标、JEV 结果、派生分数、原始输入摘要和有效期；聊天由浏览器在第二个请求中重新提交，服务端不持久化中间状态。
- JEV 是关系分类和互动维度的唯一决策来源；LLM 只负责解释，不得重新分类、重新评分或推翻 JEV。
- LLM 必须同时读取 JEV 的最终选择、完整概率分布、`confidence`、各维度的显式状态，以及服务端派生的互动平衡度和综合互动指数，并让措辞强度服从置信度。只有 `status: "available"` 的维度才向解释层提供 Score；`insufficient_evidence` 不提供 Score，不得由解释层重新应用阈值推导状态。
- 关系细分属于可降级结果。细分请求失败或超时时，`/api/analyze/signals` 仍返回已经完成的主导场景、十个互动维度和派生指标，不重新调用第一阶段，也不把整份结果转成 `502` 或 `504`。

### 分析等待状态

MVP 使用两个普通 JSON 请求，不实现 SSE 或后台任务。前端按真实请求状态渲染，不使用定时轮播文案：

```text
analyzing_signals
  文案：正在分析互动信号……
  页面：显示第一阶段加载状态，尚未展示分析结论

generating_explanation
  文案：正在根据以上结果生成关系解读……
  页面：展示已经返回的 JEV 分类、维度、互动平衡度与综合互动指数；关系解读区域显示加载状态

complete
  页面：在 JEV 结果下方展示完整关系解读

explanation_error
  文案：互动分析已完成，但关系解读暂时生成失败。
  页面：保留 JEV 结果，并显示“重新生成解读”按钮
```

JEV 的主导关系场景请求和条件细分请求都封装在 `/api/analyze/signals` 内部；由于前端无法观察其真实切换时刻，不得把它们拆成页面进度阶段。不得在任何单个请求内部轮播伪造阶段或展示虚假百分比。

若关系解读失败，重试时继续使用可验证的签名分析上下文；上下文因过期、签名无效、策略版本不受支持或与当前参与者及消息不匹配而无法继续使用时，公开接口统一返回上下文不可用，前端显示“重新运行完整分析”的单一恢复入口。服务端内部应保留具体原因用于测试、指标和诊断，但不得记录聊天正文或把内部原因暴露成不同的用户流程。

前端使用 `meta.analysisContextExpiresAt` 控制“重新生成解读”入口：本地判断已过期时直接切换为“重新运行完整分析”，不解析 `analysisContext`。客户端时钟仅用于改善交互，服务端的签名与有效期校验始终是最终判断。

### 上游调用与路由时延预算

MVP 使用以下初始硬上限；Route Handler 必须导出对应的 `maxDuration`，所有上游超时都通过 `AbortSignal` 执行并集中定义，不得只依赖平台终止函数：

```text
/api/analyze/signals
  Route maxDuration                         60 秒
  服务内部总截止时间                         55 秒
  主导场景与互动维度 JEV：每次尝试             20 秒，最多一次格式修复重试
  关系细分 JEV：每次尝试                        6 秒，最多一次格式修复重试

/api/analyze/explanation
  Route maxDuration                         90 秒
  服务内部总截止时间                         85 秒
  LLM 首次生成                               60 秒
  LLM 格式修复重试                           20 秒
```

格式修复重试只用于已经收到但未通过 Schema 或引用完整性校验的响应；网络失败或超时不触发格式修复。LLM 的重试会附加明确的结构纠错提示；TypeSafe 原生结构化问答没有额外纠错对话入口，因此 JEV 的“格式修复重试”具体表现为对同一确定性问题请求最多重试一次，并再次执行全部 Schema 与完整性校验。开始细分前必须检查剩余总预算；不足以完成一次细分尝试时直接返回 `temporarily_unavailable`。细分任一次失败、超时或最终格式无效都必须在服务内部截止时间前转换为可降级结果，不得等待 Vercel 将整个 `/api/analyze/signals` 请求终止。上线前根据真实上游延迟复核这些初始值，但不得破坏主结果优先和细分可降级语义。

解读调用关闭 DeepSeek 思考模式，最多生成 4096 token，SDK 不执行隐式网络重试。解读文案聚焦少量关键维度并避免重复原文；完整聊天仍传给模型，不做自动截断或抽样。解释提示中的五级量表只传一次，各可用维度的五级概率保留完整数值。

## 3. 目录结构

```text
src/
├── app/
│   ├── page.tsx
│   └── api/analyze/
│       ├── http.ts
│       ├── signals/route.ts
│       └── explanation/route.ts
├── components/
│   ├── chat-input.tsx
│   ├── chat-preview.tsx
│   ├── analysis-loading.tsx
│   ├── relationship-result.tsx
│   ├── interaction-result.tsx
│   └── explanation-result.tsx
├── lib/
│   ├── contracts/
│   │   ├── chat.ts
│   │   ├── analysis.ts
│   │   └── errors.ts
│   ├── chat/
│   │   ├── parser.ts
│   │   └── normalize.ts
│   └── config/
│       ├── input-limits.ts
│       └── wechat-markers.ts
├── server/
│   ├── analysis/
│   │   ├── ruleset.ts
│   │   ├── deterministic-metrics.ts
│   │   ├── scoring.ts
│   │   ├── input-validation.ts
│   │   ├── service-error.ts
│   │   ├── signals-service.ts
│   │   └── explanation-service.ts
│   ├── typesafe/
│   │   ├── client.ts
│   │   ├── schemas.ts
│   │   └── questions.ts
│   ├── llm/
│   │   ├── client.ts
│   │   ├── schemas.ts
│   │   └── prompt.ts
│   ├── security/
│   │   ├── analysis-context.ts
│   │   └── message-digest.ts
│   └── upstream-error.ts
└── test/
    └── fixtures/
```

可以随实现微调目录，但必须保持以下边界：

- Route Handler 只负责 HTTP 输入输出、调用应用服务和映射错误。
- `src/lib/contracts` 只放浏览器和服务端都可安全引用的公开契约，不得读取服务端环境变量。
- `src/lib/config/input-limits.ts` 只保存浏览器预校验和服务端复验都需要的输入上下限，不包含评分阈值、权重或规则集版本。
- `src/server` 下的模块必须使用 `server-only`，不得被客户端组件导入。
- `ruleset.ts`、`deterministic-metrics.ts` 和 `scoring.ts` 属于服务端可信计算边界，只能由 `src/server` 内部模块引用。前端只消费公开响应中的 `status`、值、标签、`summary` 和 `confidenceBand`，不读取或重算服务端阈值。
- TypeSafe 与 LLM 的原始响应 Schema 属于各自适配器，不得直接作为公开 API Schema。
- 评分阈值和权重集中在 `src/server/analysis/ruleset.ts`；输入限制集中在 `src/lib/config/input-limits.ts`。二者都不得散落在组件或 Route Handler 中。

## 4. 结构化数据与接口契约

所有外部输入、公开响应和模型输出都以 Zod Schema 为运行时事实来源，TypeScript 类型通过 `z.infer` 推导，不手工维护第二套定义。下面的 TypeScript 接口用于表达必须保持的契约语义，不要求实现逐字照搬类型名。

### 消息结构

```ts
type ParticipantId = "a" | "b";
type MessageKind = "text" | "emoji" | "image" | "sticker" | "voice" | "file";
type DimensionScore = 0 | 1 | 2 | 3 | 4;

interface ChatMessage {
  id: string;                 // 本次分析内稳定且唯一
  senderId: ParticipantId;
  timestamp: string;          // 带 +08:00 偏移的 ISO 8601
  kind: MessageKind;
  text: string;               // 非文本消息使用规范化占位符
}
```

解析器使用昵称识别消息归属，并按有效消息中首次出现的顺序映射为 `a` 与 `b`。预览中选择“我”只确定 `participants.meId` 与 `participants.otherId`，不重写消息的 `senderId`。系统通知在生成 `ChatMessage` 前丢弃，不进入消息计数、字符计数、摘要或模型输入。

消息正文不做脱敏；其中出现的姓名、电话、邮箱或其他信息会随正文发送到服务端和第三方模型。

### 模型结果结构

公开 API 使用经过适配的领域结构，不直接透传 TypeSafe 原始响应：

```ts
type RelationshipBroadId =
  | "romantic_or_partner"
  | "friendship"
  | "family"
  | "work_or_education"
  | "commercial_or_service"
  | "weak_tie_or_new_contact"
  | "other"
  | "unclear";

type RelationshipSubtypeId =
  | "established_partner"
  | "mutual_romantic_exploration"
  | "one_sided_pursuit"
  | "former_partner"
  | "romantic_unclear"
  | "close_friend"
  | "ordinary_friend"
  | "new_friend"
  | "reconnecting_friend"
  | "friendship_unclear"
  | "parent_child"
  | "siblings"
  | "grandparent_grandchild"
  | "other_relative"
  | "family_unclear"
  | "peer_colleagues"
  | "manager_report"
  | "teacher_student"
  | "classmates"
  | "external_collaboration"
  | "work_or_education_unclear"
  | "merchant_customer"
  | "professional_service"
  | "customer_support"
  | "one_off_transaction"
  | "commercial_or_service_unclear"
  | "initial_contact"
  | "acquaintance"
  | "community_contact"
  | "brief_task_contact"
  | "weak_tie_unclear";

type DimensionId =
  | "a_engagement"
  | "b_engagement"
  | "a_warmth"
  | "b_warmth"
  | "responsiveness_coordination"
  | "self_disclosure"
  | "support_care"
  | "future_orientation"
  | "tension_hostility"
  | "power_asymmetry";

interface ChoiceProbability<TId extends string> {
  id: TId;
  label: string;
  probability: number;        // 0～1
}

interface ChoiceResult<TId extends string> {
  selectedId: TId;
  selectedLabel: string;
  summary: string;            // 服务端按统一置信度规则生成的可直接展示摘要
  confidenceBand: "insufficient" | "low" | "medium" | "high";
  probabilities: ChoiceProbability<TId>[];
  confidence: number;         // 0～1
}

interface DimensionLevel {
  score: DimensionScore;
  label: string;
}

interface DimensionProbability {
  score: DimensionScore;
  label: string;
  probability: number;        // 0～1
}

interface DimensionResultBase {
  dimensionId: DimensionId;
  label: string;
  confidence: number;         // 0～1
}

type DimensionResult = DimensionResultBase &
  (
    | {
        status: "available";
        score: DimensionScore; // 统一的五级强度量表
        confidenceBand: "medium" | "high";
        levels: DimensionLevel[];
        probabilities: DimensionProbability[];
      }
    | {
        status: "insufficient_evidence";
      }
  );

type SubtypeResult =
  | {
      status: "available";
      result: ChoiceResult<RelationshipSubtypeId>;
    }
  | {
      status: "skipped";
      reason:
        | "broad_unclear_or_other"
        | "low_confidence"
        | "small_probability_margin";
    }
  | {
      status: "temporarily_unavailable";
    };

type DerivedMetric =
  | {
      status: "available";
      value: number;          // 0～100
      label: string;
      confidenceBand: "medium" | "high";
    }
  | {
      status: "insufficient_evidence";
      value: null;
      confidenceBand: null;
    };

type InteractionIndexComponentId =
  | "engagement_mean"
  | "warmth_mean"
  | "responsiveness_coordination"
  | "self_disclosure"
  | "support_care"
  | "future_orientation";

interface InteractionIndexComponent {
  componentId: InteractionIndexComponentId;
  effectiveWeight: number;    // 重新归一化后的权重，0～1
}

type InteractionIndexMetric =
  | {
      status: "available";
      value: number;          // 0～100
      label: string;
      confidenceBand: "medium" | "high";
      includedComponents: InteractionIndexComponent[];
    }
  | {
      status: "insufficient_evidence";
      value: null;
      confidenceBand: null;
      includedComponents: [];
    };
```

所有 Schema 使用严格模式并拒绝未知字段。概率值必须位于 0～1，同一结果中的概率和允许 `±0.01` 浮点误差；`selectedId` 必须存在于概率列表中且属于最高概率选项之一。主导关系场景的 `probabilities` 必须恰好包含全部八个 `RelationshipBroadId` 且各出现一次；可用细分结果必须恰好包含当前主导大类定义的全部细分选项且各出现一次，不得混入其他大类选项。

`DimensionResult` 的状态只由服务端规则集根据上游结果确定：`available` 分支的公开 `score` 必须是 0～4 的整数并属于最高概率等级之一，`levels` 与 `probabilities` 必须按 0～4 恰好各包含五项且一一对应；`insufficient_evidence` 分支不得出现 `score`、`levels` 或 `probabilities`，只保留维度标识、标签和置信度。TypeSafe 原始 Score 允许为 0～4 的浮点值，适配器不得直接透传：先选择概率最高的等级；如最高概率并列，选择与原始 Score 距离最近的等级；距离仍相同时选择较小等级。该离散化只发生在 TypeSafe 适配器中并由测试向量固定。客户端和 LLM 不得根据 `confidence` 重算状态，也不能从低置信度原始分布恢复或展示数值。十个维度必须恰好各出现一次，不得缺失或重复。

`InteractionIndexMetric.includedComponents` 在可用时必须包含至少四个且不得重复，`effectiveWeight` 之和允许 `±0.01` 浮点误差；它们是服务端已经应用置信度剔除和重新归一化后的最终计算口径，客户端和 LLM 不得再次筛选或加权。所有面向 UI 的标签均由服务端配置按 ID 或状态映射，不信任上游返回的自由文本。Choice 的 `summary` 与 `confidenceBand` 由服务端规则集依据第 7 节阈值生成；可用维度的 `confidenceBand` 也由服务端确定。客户端只渲染这些显示语义，不读取或重算置信度阈值。模型版本只在响应顶层 `meta.modelVersions` 返回，不在每个结果中重复保存；分析算法口径由 `meta.analysisRulesetVersion` 标识。

### `/api/analyze/signals` 请求

```ts
interface SignalAnalysisRequest {
  participants: {
    meId: ParticipantId;
    otherId: ParticipantId;
  };
  messages: ChatMessage[];
}
```

- 不接收客户端计算的消息统计、JEV 分数、综合指数或置信度。
- `meId` 与 `otherId` 必须不同，并且二者必须完整覆盖 `a` 与 `b`。
- 消息 ID 必须非空且在本次请求中唯一；双方都必须至少出现一次，具体样本门槛按第 5 节执行。
- 服务端必须拒绝 `kind` 与规范化正文不一致的消息：媒体 `kind` 的正文必须完全等于对应规范化占位符；`emoji` 的正文必须是唯一的方括号表情标记；包含其他正文的消息必须使用 `text`。

### `/api/analyze/signals` 响应

```ts
interface SignalAnalysisResponse {
  relationshipClassification: {
    broad: ChoiceResult<RelationshipBroadId>;
    subtype: SubtypeResult;
    notGroundTruth: true;
  };
  dimensions: DimensionResult[];
  derivedSignals: {
    interactionBalance: DerivedMetric;
  };
  interactionIndex: InteractionIndexMetric;
  analysisContext: string;       // 短时有效的服务端签名上下文，不含聊天正文
  meta: {
    requestId: string;
    messageCount: number;
    modelVersions: { typesafe: string };
    analysisRulesetVersion: string;
    explanationPolicyVersion: string;
    analysisContextExpiresAt: number; // Unix 秒；必须等于签名 payload.expiresAt
  };
}
```

确定性指标及签名上下文的内部结构：

```ts
interface DeterministicMetrics {
  messageCount: number;
  normalizedCharacterCount: number;
  participantMessageCounts: Record<ParticipantId, number>;
  participantMessageShares: Record<ParticipantId, number>; // 0～1
}

interface AnalysisContextPayload {
  version: 1;
  issuedAt: number;            // Unix 秒
  expiresAt: number;           // Unix 秒
  participants: {
    meId: ParticipantId;
    otherId: ParticipantId;
  };
  messageDigest: string;
  deterministicMetrics: DeterministicMetrics;
  relationshipClassification: SignalAnalysisResponse["relationshipClassification"];
  dimensions: DimensionResult[];
  derivedSignals: SignalAnalysisResponse["derivedSignals"];
  interactionIndex: InteractionIndexMetric;
  modelVersions: { typesafe: string };
  analysisRulesetVersion: string;
  explanationPolicyVersion: string;
}
```

`analysisContext` 使用独立的 `ANALYSIS_CONTEXT_SECRET` 对版本化 payload 进行 HMAC-SHA256 签名，编码为 URL-safe 字符串；它是签名而不是加密，因此不得包含聊天正文。默认有效期为 10 分钟，并通过集中配置调整。服务端验证签名时必须使用恒定时间比较，并先限制 token 长度再解析。

`messageDigest` 使用 SHA-256 计算，输入为确定性序列化后的 `version`、`participants.meId`、`participants.otherId`，以及保持原顺序的全部消息字段：`id`、`senderId`、`timestamp`、`kind`、`text`。两个接口必须复用同一规范化和序列化函数。消息 ID 必须纳入摘要，防止客户端在正文不变时替换证据引用。

客户端可以暂存并回传 `analysisContext`，但不能修改其中内容。服务端不得使用 `TYPESAFE_API_KEY` 或 `LLM_API_KEY` 作为签名密钥。`analysisRulesetVersion` 和 `explanationPolicyVersion` 都位于签名 payload 内，因此验证签名后可信；`/api/analyze/explanation` 仍必须要求二者与当前服务支持的版本精确相等。上下文 Schema 版本或任一策略版本不受当前服务支持时，统一按 `ANALYSIS_CONTEXT_UNAVAILABLE` 处理，不尝试兼容性猜测。

### `/api/analyze/explanation` 请求

```ts
interface ExplanationRequest {
  participants: {
    meId: ParticipantId;
    otherId: ParticipantId;
  };
  messages: ChatMessage[];
  analysisContext: string;
}
```

- 第二个请求重新提交结构化聊天，因为服务端不保存第一次请求的数据。
- 服务端必须再次进行 Zod 校验和限制检查，使用与第一个接口相同的规范化规则生成消息摘要，并验证签名、有效期、参与者、消息摘要、分析规则集版本及解释策略版本。不得重新计算确定性指标、JEV 结果或派生分数。
- 不接收独立的客户端 JEV 分数、综合指数或概率字段。

### `/api/analyze/explanation` 响应

```ts
interface ExplanationResponse {
  relationshipExplanation: {
    headline: string;
    overview: string;
    classificationExplanation: string;
    confidenceExplanation: string;
    dimensionInterpretations: Array<{
      dimensionId: DimensionId;
      evidence: Array<{
        messageId: string;
        excerpt: string;        // 由服务端按 ID 从原消息取值
        truncated: boolean;
      }>;
      explanation: string;
    }>;
    uncertainties: string[];
    caveats: string[];
  };
  meta: {
    requestId: string;
    messageCount: number;
    modelVersions: { llm: string };
    analysisRulesetVersion: string;
    explanationPolicyVersion: string;
  };
}
```

响应包含 1～10 项不重复的关键维度解释；`dimensionId` 必须属于已请求的十个维度。每项包含 1～5 条 `evidence`（提示词仍引导模型引用 1～3 条，5 为硬上限），其中 `messageId` 不重复且全部存在于请求消息中。`excerpt` 由服务端按合法 ID 从原消息提取，不得使用 LLM 生成的引文；每条最多保留前 500 个 Unicode code point，超过时截断并设置 `truncated: true`，不得静默返回整条超长正文。客户端可根据 `messageId` 定位本地原始消息，但不得自行替换服务端返回的证据文本。客户端在展示每条证据时，必须通过 `messageId` 从本地消息取 `senderId` 并标出 A/B；定向维度按 `dimensionId` 标出 A/B，其余维度标为“整体互动”，不从 LLM 的自由文案推断发送者或维度归属。客户端还按 `dimensionId` 把关键维度解释固定分为 A、B、整体互动三个区块，每个区块有独立标题行；区块内保留模型返回的相对顺序。若某区块没有入选关键维度，仍展示标题及“本次解读未单独展开”的说明，不推断为该类信号不存在，也不补造解释。

### 错误语义

所有失败响应使用同一结构：

```ts
type ApiErrorCode =
  | "INVALID_REQUEST"
  | "SAMPLE_TOO_SMALL"
  | "PAYLOAD_TOO_LARGE"
  | "ANALYSIS_CONTEXT_UNAVAILABLE"
  | "UPSTREAM_INVALID_RESPONSE"
  | "UPSTREAM_TIMEOUT"
  | "INTERNAL_ERROR";

interface ApiErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;           // 面向用户，不含内部细节
    requestId: string;
  };
}
```

- `400`：JSON 无法解析、字段类型错误，或签名分析上下文不可继续使用。上下文无效、过期、不匹配等具体原因只在服务端内部分类。
- `413`：消息数量或规范化文本超过限制。
- `422`：格式合法但无法形成两人聊天，或样本不足。
- `502`：主导场景与互动维度的 JEV 请求或 LLM 请求上游失败、返回不合法；关系细分请求失败按可降级结果处理，不返回此状态。
- `504`：主导场景与互动维度的 JEV 请求或 LLM 请求超时；关系细分请求超时按可降级结果处理，不返回此状态。
- `500`：服务端配置缺失、签名密钥不可用或其他未预期内部异常，统一使用 `INTERNAL_ERROR`，不得把内部异常伪装成上游错误。

前端对 `ANALYSIS_CONTEXT_UNAVAILABLE` 统一显示“当前分析上下文已失效，请重新运行完整分析”，不区分过期、签名无效、策略版本不受支持和参与者或消息不匹配。服务端仍需对具体原因建立内部测试和不含敏感信息的聚合指标。错误响应不返回密钥、完整上游响应、内部校验细节或聊天原文。所有成功与失败响应都设置 `Cache-Control: no-store`。

## 5. 聊天解析

### 解析原则

- 解析器是确定性代码，不调用 JEV 或 LLM。
- “仅支持唯一微信桌面端复制格式”是浏览器解析器和产品入口的约束。公开 API 接收的是结构化两人对话，只能复验字段、参与者、样本限制、时间戳及 `kind` 与规范化占位符的一致性，不能证明原始文本确实来自微信。
- 消息计数和参与比例由代码计算；合法时间戳只做规范化并保留，MVP 暂不计算回复间隔。
- 当前微信格式中的每条消息都必须有合法时间；解析不到时整体失败，不补造时间。
- 系统通知必须按明确匹配规则识别，并在生成 `ChatMessage` 前丢弃。MVP 的匹配规则集中在 `src/lib/config/wechat-markers.ts`，只使用带首尾锚点的保守模式；不得把包含通知关键字的普通聊天误删。当前初始集合覆盖撤回、添加好友、朋友验证和消息拒收等明确通知，上线前必须用人工构造且对照真实结构的验收样例校准。
- 图片、表情、贴纸、语音、文件占位符不能删除，应分别规范化为 `[图片]`、`[表情]`、`[贴纸]`、`[语音]`、`[文件]`；微信复制文本中的完整 `[动画表情]` 也规范化为 `sticker` / `[贴纸]`。只有整条正文去除首尾空白后与已知占位符完全相等时才归类为对应媒体 `kind`；正文中包含占位符但还有其他内容时保留为普通 `text`。
- MVP 不自动去重。即使发送者、时间和内容完全相同，也按用户粘贴文本中的独立记录保留，避免误删真实重复消息；如未来要处理导出重复，必须先有可验证的格式标记和独立验收样例。
- 不静默截断单条长消息或整段聊天；超限时明确要求用户缩小范围。

### 样本与长度限制

以下数值以 `AGENTS.md` 第 5 节为产品事实来源，并集中映射到 `src/lib/config/input-limits.ts`：

- 至少 8 条有效消息，并且双方各至少 2 条；有效消息是系统通知被排除后生成的全部 `ChatMessage`，包括文本、表情及媒体占位消息。不足时不调用外部模型。
- 规范化后最多 500 条消息或 20,000 个字符，以先达到者为准；字符数按所有 `ChatMessage.text` 的 Unicode code point 数量之和计算，包含规范化媒体占位符。
- 超限时提示用户选择更短的时间范围，不自动抽样或只保留开头/结尾。

### 唯一支持的粘贴格式：微信桌面端聊天复制文本

第一版只支持产品验收样例验证过的、符合下述结构的微信桌面端聊天复制纯文本。其他微信复制结构以及 QQ、Telegram、截图 OCR 或任意 `昵称: 内容` 格式均不兼容。解析器按以下抽象结构识别记录，本文档不保存真实聊天样例：

```text
发送者昵称
中文日期时间
一行或多行消息正文

下一条消息……
```

解析规则：

- 先把 CRLF 统一为 LF，并去掉文本首尾空行。
- 一条记录由“发送者行、时间行、正文”组成，记录之间由一个或多个空行分隔。
- 时间行只接受 `YYYY年MM月DD日 H:mm` 或 `YYYY年MM月DD日 HH:mm`（日期与小时之间允许一个或多个 ASCII 空格，小时为 0～23，分钟必须为两位）；单数字小时在解析后补零，按 `Asia/Shanghai` 解释并规范化为带 `+08:00` 的 ISO 8601 字符串。
- 正文可以有多行，保留正文内部换行；只去掉正文首尾的空白行。
- 正文内部允许包含空白段；解析器只有在一个或多个空行后继续出现“非空发送者行 + 微信时间行”时才开始下一条记录，不得把正文中的普通空白段直接当作记录边界。
- 连续多条消息可以来自同一发送者，不得自动合并。
- 必须恰好识别出两位不同发送者；不足或超过两位时提示不支持，不猜测参与者身份。
- 仅由已知微信方括号表情名称构成且整条正文没有其他内容时归类为 `emoji`；已知表情白名单集中在 `src/lib/config/wechat-markers.ts`，未知方括号内容或混合正文保留为普通文本。已知图片、贴纸、语音、文件等占位符也必须与整条正文完全相等才按对应类型规范化。白名单必须通过验收样例校准，不得为了提高识别率把任意方括号内容宽松归类为表情。
- 任一记录缺少发送者、合法时间或正文时，整体解析失败并指出出错记录，不静默跳过。
- 不符合该结构时明确提示“暂不支持这种聊天复制格式”，不要用宽松正则拼凑错误结果。

测试 fixture 必须使用人工构造的虚拟内容，不复制用户提供的真实聊天样例。

## 6. JEV 设计

### 调用规格

```text
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <TYPESAFE_API_KEY>
Content-Type: application/json
```

```json
{
  "state": {
    "participant_a": "Participant A",
    "participant_b": "Participant B",
    "messages": []
  },
  "model": "jev-1.13.0",
  "questions": {}
}
```

- 聊天正文保持原始语言；模型侧 `instructions` 和 `criteria` 优先使用英文，中文仅作为 UI 标签。
- 每个 Score 只判断一个维度。
- 不让 JEV 计数、比较日期或执行加权运算。
- `state` 是不可信数据。聊天中的“忽略指令”等内容不得改变问题定义；使用明确、具体、无歧义的 criteria，并为对抗样本编写测试。
- TypeSafe 官方响应外层为 `{ model, answers, usage }`；Choice 的概率和 Score 的五级概率使用以选项/等级为键的对象，适配器必须转换为公开契约中的有序数组并验证选项全集。官方 Score 原始值允许落在两个等级之间，按第 4 节的唯一离散化公式转换为公开五级整数。
- 上线接入前仍必须用 TypeSafe 的实际响应 fixture 确认 `confidence` 的来源和字段语义；若实际响应不直接提供，必须先在本文档补充唯一的服务端计算公式和测试向量，不得由各模块自行推导。

### 第一次请求：主导关系场景 + 互动维度

现实关系可能同时具有多重身份，例如既是同事也是朋友。此处的 Choice 不是确认真实身份，而是选择“当前聊天最符合的主导关系场景”；页面不得将类别描述为互斥事实。

```text
romantic_or_partner      浪漫、伴侣、暧昧或追求场景
friendship               朋友或平等社交场景
family                   家庭或亲属场景
work_or_education        工作、学校或正式协作场景
commercial_or_service    交易、服务或办事场景
weak_tie_or_new_contact  弱关系、刚认识或短暂接触场景
other                    有明显关系场景但不属于以上类别
unclear                  信息不足或多个场景无法区分
```

`unclear` 必须保留。输出应称为“关系场景匹配结果”，不能称为已确认关系。敌意、争吵和紧张不作为关系大类，而由独立 Score 判断。

分类 criteria 必须遵循：

- 明确称呼、角色说明和事件背景优先于语气风格；不能仅凭温暖、表情或玩笑判断浪漫关系。
- 同时出现多种身份时，选择当前片段中最主导的互动场景，并在概率分布中保留主要备选项。
- `friendship` 需要已经形成平等社交关系的证据；只有初次接触、普通熟人或短暂联系证据时优先考虑 `weak_tie_or_new_contact`。
- 缺少直接关系证据且多个类别接近时选择 `unclear`，不能强行分类。

互动维度初始定义：

```text
a_engagement                  A 对当前互动的关注与投入
b_engagement                  B 对当前互动的关注与投入
a_warmth                      A 对 B 表现出的友好、亲近与积极情感
b_warmth                      B 对 A 表现出的友好、亲近与积极情感
responsiveness_coordination   双方是否接住彼此内容、回应情绪并协调推进对话
self_disclosure               双方是否表达个人经历、感受或脆弱信息
support_care                  双方是否提供安慰、肯定、帮助或实际支持
future_orientation            双方是否明确表达继续联系、见面或共同活动的意愿
tension_hostility             紧张、敌意、贬低、攻击或对抗信号
power_asymmetry               命令、服从、角色权威、决策权或控制不对等信号
```

其中前四项是方向性指标，后六项是整体互动指标。不要把所有维度机械地做成 A→B、B→A 两套。

十个 Score 统一使用五级强度量表，具体 criteria 必须针对各维度编写，但等级语义保持一致：

```text
0  未观察到明显信号
1  少量或很弱的信号
2  中等、但不完全一致的信号
3  较多且较一致的信号
4  强烈且持续的信号
```

“证据不足”由 `confidence` 门槛表达，不作为第六个等级，也不能与高置信度的 0 分混为一谈。对于 `tension_hostility` 和 `power_asymmetry`，分数仍表示对应信号强度，高分不自动代表关系质量较差。

`self_disclosure` 只判断聊天中可观察的自我表达，不得据此断言内在信任。`power_asymmetry` 描述权力或控制结构，高分不自动等于伤害或不健康；只有出现具体威胁、强迫或贬低证据时才能说明风险。

不再让 JEV 单独判断笼统的 `reciprocity`。服务端根据双方 `engagement` 与 `warmth` 的归一化差异计算 `interactionBalance`，它只表示当前样本中的投入和温度是否相对均衡，不等于情感互惠或关系质量。任一所需方向性指标置信度不足时，该值为 `null`。

```text
interactionBalance = 100 × (1 - (|a_engagement - b_engagement| + |a_warmth - b_warmth|) / 2)
```

公式中的四个分数均先归一化到 0～1，最终值限制在 0～100 并四舍五入为整数。只有四项 `confidence` 均不低于 `0.45` 时才计算；其 `confidenceBand` 由四项中最低的 confidence 决定：`0.45～0.70` 为 `medium`，`> 0.70` 为 `high`。不满足计算条件时返回 `insufficient_evidence`，不提供置信度等级。

### 第二次请求：关系细分

仅在以下条件同时满足时调用：

- 大类不是 `unclear` 或 `other`。
- 大类 `confidence >= 0.65`。
- 第一名与第二名概率差至少为 `0.15`。

未调用时按上述顺序确定唯一跳过原因：大类为 `unclear` 或 `other` 时返回 `broad_unclear_or_other`；否则置信度不足返回 `low_confidence`；否则概率差不足返回 `small_probability_margin`。细分请求已经发出但上游失败或超时时，返回 `status: "temporarily_unavailable"`；它与因业务条件未满足而产生的 `skipped` 必须区分。此时主导场景、十个互动维度、派生指标和签名分析上下文仍正常返回，关系解读只能基于已有结果说明细分暂时不可用。

初始细分：

```text
romantic_or_partner
  established_partner / mutual_romantic_exploration / one_sided_pursuit / former_partner / romantic_unclear
  已建立伴侣关系 / 双向暧昧或试探 / 单向追求或投入 / 曾经的伴侣关系 / 无法细分

friendship
  close_friend / ordinary_friend / new_friend / reconnecting_friend / friendship_unclear
  亲密朋友 / 普通朋友 / 新建立的朋友关系 / 疏远或重新联系的朋友 / 无法细分

family
  parent_child / siblings / grandparent_grandchild / other_relative / family_unclear
  亲子 / 兄弟姐妹 / 祖孙 / 其他亲属 / 无法细分

work_or_education
  peer_colleagues / manager_report / teacher_student / classmates / external_collaboration / work_or_education_unclear
  平级同事 / 上下级 / 师生或指导关系 / 同学 / 外部协作关系 / 无法细分

commercial_or_service
  merchant_customer / professional_service / customer_support / one_off_transaction / commercial_or_service_unclear
  商家与顾客 / 专业服务关系 / 平台客服或售后 / 一次性交易或办事 / 无法细分

weak_tie_or_new_contact
  initial_contact / acquaintance / community_contact / brief_task_contact / weak_tie_unclear
  初次联系 / 普通熟人 / 社群邻里或共同圈子联系人 / 短暂事务接触 / 无法细分
```

细分选项应尽量可区分，不把“损友式互动”等互动风格与身份类型放在同一个 Choice 中；这类风格只能在文案中依据玩笑和调侃证据描述。不得仅凭语气推断性别；亲子、上下级、师生等角色只有在称呼或上下文明确时才选择，否则使用更宽泛的细分或“无法细分”。不得根据单个聊天片段推断长期联系频率。细分证据不充分时应优先返回“无法细分”，不能强行选择。

### 概率展示

两层概率不能混在同一个排行榜：

```text
主导关系场景：朋友 61% / 浪漫或伴侣 27% / 工作或学校 8% / 弱关系或新联系人 2% / 家庭 1% / 交易或服务 1% / 其他 0% / 信息不足 0%
朋友细分：亲密朋友 72% / 普通朋友 20% / 新建立的朋友关系 5% / 疏远或重新联系的朋友 2% / 无法细分 1%
```

两层数据在公开契约和 UI 状态中必须保持独立，并分别展示各自完整的选项集合；展示命名及现实关系边界以 `AGENTS.md` 第 4、6 节为准。

## 7. 评分与置信度

### 综合互动指数

Score 按 `score / 4` 归一化到 0～1。互动指数初始权重：

```text
双方 engagement 平均值         20%
双方 warmth 平均值             25%
responsiveness_coordination    20%
self_disclosure                10%
support_care                   15%
future_orientation             10%
```

`tension_hostility`、`power_asymmetry` 和代码派生的 `interactionBalance` 单独展示，不混入综合指数。高紧张并不必然说明缺乏亲密度，例如家人或情侣争执；权力不对等也可能来自正常角色结构。LLM 只能结合具体证据解释，不得自动诊断关系健康程度。

指数包含六个正向组件：双方 engagement 平均值、双方 warmth 平均值、`responsiveness_coordination`、`self_disclosure`、`support_care` 和 `future_orientation`。只有至少四个组件的组成分数 `confidence >= 0.45` 时才展示；方向性均值的组件置信度取双方较低值。低置信度组件不参与计算，其余权重按比例重新归一化；不足四项时返回 `insufficient_evidence`。加权结果限制在 0～100 并四舍五入为整数。可用结果必须通过 `includedComponents` 返回实际参与计算的组件 ID 和归一化后的 `effectiveWeight`，使客户端和解释层使用服务端已经确定的同一口径。指数的置信度取实际参与计算组件中的最低值：`0.45～0.70` 为 `medium`，`> 0.70` 为 `high`。权重和阈值只是产品初值，不是经过验证的心理量表，必须集中定义、随 `ANALYSIS_RULESET_VERSION` 版本化，并在未来用人工标注样本校准。同一份响应和签名分析上下文必须携带对应规则集版本，避免把不同规则生成的结果当作同一口径。

### Score 置信度

```text
confidence < 0.45  服务端返回 status: "insufficient_evidence"；不提供 score，不让客户端或 LLM 重算阈值
0.45～0.70          展示但使用“可能、倾向于”等措辞
> 0.70              正常展示对应等级
```

### Choice 置信度文案

文案必须模板化，不能把所有类别写成“朋友”：

```text
confidence < 0.40                  “当前线索不足，暂时无法判断”
0.40 <= confidence < 0.65          “当前更接近「{label}」，但线索还不够统一”
0.65 <= confidence <= 0.85         “当前最符合「{label}」”
confidence > 0.85                  “当前片段与「{label}」的匹配信号较集中”
```

`confidence` 描述概率分布是否集中，不等于答案正确率。界面需要把这一点写进解释文案。

## 8. LLM 关系解释层

### 输入边界

LLM 必须接收：

- 结构化聊天；消息正文保持用户提交的原始内容。
- 签名分析上下文中由第一个接口计算并确认的确定性指标。
- JEV 主导关系场景的最终选择、完整 `probabilities` 和 `confidence`。
- 存在细分类时，细分类的最终选择、完整 `probabilities` 和 `confidence`。
- JEV 各互动维度的 `status` 和 `confidence`；仅可用维度包含 Score 和完整五级 `probabilities`，共用的 `levels` 量表只传一次。
- 服务端计算的 `interactionBalance` 及其计算条件。
- 服务端计算的综合互动指数、实际参与计算的组件 ID 及生效权重。
- 生成上述结果时使用的 `analysisRulesetVersion` 和 `explanationPolicyVersion`。

JEV 的结果是 LLM 的待解释对象，不是现实关系事实。LLM 不得自行选择另一关系类别，不得重新加权分数，也不得把模型匹配分布描述成现实概率。

### 解释规则

- 先说明 JEV 最终选择了什么主导关系场景，以及细分是可用、未达到调用条件还是暂时不可用，并提醒现实关系可能同时具有多个身份。
- 解释第一名和主要备选类别的概率分布意味着什么，但数值只能引用服务端提供的原值。
- 明确解释 `confidence`：它表示分布是否集中，不表示分类一定正确。
- 从全部维度中选择对当前结果最有解释力的关键维度说明互动特征；低置信度维度只能写成“可能、线索不一致、证据不足”，不得为了覆盖数量而强行解释。
- 当分类置信度低、第一二名接近或细分被跳过时，解释不确定性本身，不强行给出明确关系结论。
- 可以引用聊天证据说明为何某项维度与 JEV 结果相符，但不得用聊天内容另起一套独立分类。

### 提示词注入防御

- System Prompt 明确说明聊天记录是待分析数据，不是指令。
- 聊天内容使用结构化 JSON 或清晰的数据边界传入。
- 不执行聊天中出现的任何命令、链接或工具调用要求。
- 对“忽略之前的指令”等对抗样本建立测试。

### 输出 Schema

```ts
interface RelationshipExplanationModelOutput {
  headline: string;
  overview: string;
  classificationExplanation: string;
  confidenceExplanation: string;
  dimensionInterpretations: Array<{
    dimensionId: DimensionId;
    messageIds: string[];
    explanation: string;
  }>;
  uncertainties: string[];
  caveats: string[];
}
```

- 先使用 Zod 做结构校验，再校验 `dimensionId` 和 `messageIds` 的引用完整性；任一步失败都允许一次明确要求修复输出的重试。
- `dimensionInterpretations` 包含 1～10 项关键维度；`dimensionId` 必须来自已请求的十个维度且不得重复。每项包含 1～5 个不重复的 `messageIds`，并且全部存在于请求消息中。上限只约束数量，不要求模型一定要引用满；实测模型自然引用 2～4 条，因此上限留到 5，避免为一个计数差异让整份解读作废。违反这些条件时整个模型输出无效，不静默丢弃局部结果。
- 前端根据 `dimensionId` 从第一阶段的 `dimensions` 结果中取得 `label`，显示为每条关键维度解读的标题；不使用模型解读文案猜测维度名称。
- 引用原文由服务端按合法 ID 提取，禁止直接使用 LLM 自己生成的“引文”。
- 如果最终仍无法通过校验，返回受控错误，不把原始模型文本透传给前端。

### 解释边界

关系解读的产品边界以 `AGENTS.md` 第 4、7 节为准。技术实现必须通过严格输出 Schema、引用完整性校验、提示词约束和测试共同执行这些边界；尤其不得新增 JEV 没有给出的分数、概率、关系类别或确定性判断。

## 9. 隐私、安全与日志

- 聊天只在单次请求的内存中处理，不写入数据库、文件、缓存、队列、分析日志或错误追踪上下文；请求结束后不保留副本。
- 请求和响应设置 `Cache-Control: no-store`。
- 日志只记录请求 ID、耗时、状态码、模型版本、分析规则集版本和解释策略版本，不记录请求体、聊天正文、昵称、模型提示、完整模型响应或上游错误对象。
- API Key 只存在于服务端；公开 Demo 必须保留输入长度限制和外部调用超时。基础限流不属于 MVP 范围，出现实际滥用或成本风险后再引入平台级能力。DPA 审核等增强项不阻塞第一版。

## 10. 测试要求

MVP 测试只覆盖高风险纯逻辑、安全边界和一条完整用户路径，不追求分支穷举或覆盖率数字。JEV 与 LLM 在自动测试中统一使用 mock，不调用真实外部 API。

### Vitest

- 解析器使用一组代表性正常 fixture 和一组非法 fixture，覆盖参与者识别、消息顺序、多行正文、媒体占位、重复消息保留及输入上下限。
- 评分逻辑各使用一个正常样例和一个证据不足样例，验证 `interactionBalance`、综合互动指数及关键置信度门槛。
- 对两个公开接口和两个上游适配器分别验证一个合法响应和一个非法响应，不为每个 Zod 字段排列组合单独编写测试。
- 签名上下文验证正常、被篡改、过期和策略版本不受支持四种情况；参与者或消息变化可用一个代表性不匹配样例覆盖。
- 服务层验证关键降级与失败路径：细分失败或预算不足时仍返回主要结果；无效证据消息 ID 先触发一次格式修复，最终仍无效时整份解释返回受控错误且不展示局部结果。
- 提示词注入使用一个代表性对抗 fixture。

### Playwright

- 只保留一条完整主流程：粘贴 → 只读预览 → 确认参与者 → 确认第三方处理提示并提交 → 展示互动结果 → 补充关系解读。该流程使用移动端视口并通过键盘完成关键操作，同时覆盖基本响应式和键盘可用性。
- 只保留一条失败恢复流程：LLM 失败后仍保留互动结果，并可以单独重试关系解读。

MVP 不要求多浏览器矩阵、视觉回归截图、每一种错误码的端到端测试、所有阈值边界排列组合或固定覆盖率指标。出现真实缺陷后再为对应场景补回归测试；无障碍、隐私和业务边界仍是实现要求，不等于每一项都必须有独立的自动化测试。

## 11. 开发顺序

1. 初始化 Next.js、TypeScript、Tailwind 和最小 shadcn/ui 组件。
2. 建立 Zod Schema、TypeScript 类型和测试 fixture。
3. 实现浏览器解析器、参与者确认和服务端结构复验；服务端不声称验证原始粘贴文本是否来自微信。
4. 实现确定性指标及版本化评分配置。
5. 封装 JEV、两层 Choice 和多维度 Score，并用 mock 验证细分失败降级。
6. 封装 Chat Completions 兼容 LLM，根据 JEV 结果生成关系解释，并完成 Zod 输出校验及证据 ID 验证。
7. 串联 `/api/analyze/signals` 与 `/api/analyze/explanation`，实现短时签名分析上下文、统一的上下文不可用恢复语义，并补齐错误、超时和 `no-store`。
8. 完成输入与只读预览、互动分析结果、关系解读等页面区域的交互和视觉打磨。
9. 运行 lint、type-check、Vitest、Playwright 主流程和生产构建。

## 12. 技术验收标准

- [ ] 浏览器解析和两个 API 都使用同一组 Zod 契约与规范化规则。
- [ ] `/api/analyze/signals` 只信任服务端计算的确定性指标，并返回合法的主导分类、条件细分和十个维度；细分上游失败或超时时保留其他结果并返回 `temporarily_unavailable`。
- [ ] 主导场景与细分 Choice 都返回各自完整且不重复的选项集合；十个维度的证据不足状态由服务端确定，客户端不重算置信度阈值。
- [ ] `/api/analyze/explanation` 验证签名、有效期、参与者、消息摘要、分析规则集版本及解释策略版本，不重新计算指标或接受客户端裸分数。
- [ ] TypeSafe 与 LLM 原始响应均经过适配器 Schema 校验，不直接透传给公开 API。
- [ ] 十个维度、评分公式、置信度门槛、显式证据不足状态、综合指数参与组件和分析规则集版本符合本文档定义，并有代表性单元测试覆盖正常与降级路径。
- [ ] LLM 输出通过结构与引用完整性校验，所有证据消息 ID 均可追溯到输入。
- [ ] 解释响应的每条引文不超过 500 个 Unicode code point，超长引文带有 `truncated` 标记；`analysisContextExpiresAt` 与签名上下文中的过期时间一致。
- [ ] 两个 Route Handler 的 `maxDuration`、服务内部截止时间和各上游 `AbortSignal` 超时符合本文档预算；细分耗尽预算不会使主结果失败。
- [ ] 所有未预期内部异常统一映射为不含内部细节的 `INTERNAL_ERROR` / `500`。
- [ ] 前端 bundle 和错误响应中不存在 API Key；服务端日志中不存在 API Key、聊天原文或完整模型响应。
- [ ] 聊天不写入数据库、文件、缓存、队列、日志或错误追踪上下文。
- [ ] 一条 Playwright 主流程和一条关系解读失败恢复流程通过；其他异常分支不作为 MVP 自动化验收门槛。
- [ ] lint、type-check、Vitest、Playwright 主流程和生产构建通过。

## 13. 上线前技术 TODO

- [ ] 使用 TypeSafe 的真实响应 fixture 复核已按官方文档实现的 `{ model, answers, usage }` 外层、Choice 完整概率对象、Score 原始浮点值和五级概率对象，并确认 `confidence` 的来源及字段语义；若实际响应仍缺少所需字段，先更新本文档、唯一适配公式和测试向量再调整实现。
- [ ] 在 Vercel Preview 环境对 JEV 主分析、JEV 细分和 LLM 解释执行延迟 smoke test，记录不含聊天正文的 P50/P95；复核初始超时预算与 `maxDuration`，并确认细分超时会稳定返回 `temporarily_unavailable` 而不是整条请求 `504`。
- [ ] 上线候选版本再次核对 TypeSafe 与 DeepSeek 的模型 ID、JSON 输出能力和兼容接口，锁定实际验收过的版本或别名，并把实际模型版本写入响应 `meta`。
- [ ] 用超长单条消息验证解释响应的 500 code point 引文上限、`truncated` 标记和前端回到本地原消息的定位体验。
- [ ] 在构建产物中确认客户端 bundle 不包含 `src/server/analysis/ruleset.ts`、评分权重、置信度阈值、签名实现或任何 API Key。

import { expect, test, type Page } from "@playwright/test";

const CHAT = `小岚
2026年09月18日 09:00
早上好，今天一起核对活动清单吗？

阿澄
2026年09月18日 09:02
可以，我十点前整理好。

小岚
2026年09月18日 09:04
谢谢，我先看场地部分。

阿澄
2026年09月18日 09:05
好，我负责物料。

小岚
2026年09月18日 09:08
午后再一起过一遍吧。

阿澄
2026年09月18日 09:09
没问题。

小岚
2026年09月18日 09:12
我把表格链接稍后发你。

阿澄
2026年09月18日 09:13
收到，谢谢。`;

const BROAD_PROBABILITIES = [
  ["romantic_or_partner", "浪漫或伴侣", 0.03],
  ["friendship", "朋友", 0.08],
  ["family", "家庭", 0.01],
  ["work_or_education", "工作或学校", 0.4],
  ["commercial_or_service", "交易或服务", 0.04],
  ["weak_tie_or_new_contact", "弱关系或新联系人", 0.05],
  ["other", "其他", 0.02],
  ["unclear", "信息不足", 0.37],
] as const;

const DIMENSIONS = [
  ["a_engagement", "A 的投入度", 3],
  ["b_engagement", "B 的投入度", 3],
  ["a_warmth", "A 的表达温度", 2],
  ["b_warmth", "B 的表达温度", 2],
  ["responsiveness_coordination", "回应协调", 4],
  ["self_disclosure", "自我表达", 1],
  ["support_care", "支持关怀", 2],
  ["future_orientation", "未来导向", 3],
  ["tension_hostility", "紧张敌意", 0],
  ["power_asymmetry", "权力不对等", 1],
] as const;

function signalsPayload() {
  const levels = [
    { score: 0, label: "未观察到明显信号" },
    { score: 1, label: "少量或很弱的信号" },
    { score: 2, label: "中等、但不完全一致的信号" },
    { score: 3, label: "较多且较一致的信号" },
    { score: 4, label: "强烈且持续的信号" },
  ];
  return {
    relationshipClassification: {
      broad: {
        selectedId: "work_or_education",
        selectedLabel: "工作或学校",
        summary: "当前最符合「工作或学校」",
        confidenceBand: "medium",
        probabilities: BROAD_PROBABILITIES.map(([id, label, probability]) => ({
          id,
          label,
          probability,
        })),
        confidence: 0.78,
      },
      subtype: { status: "skipped", reason: "small_probability_margin" },
      notGroundTruth: true,
    },
    dimensions: DIMENSIONS.map(([dimensionId, label, score]) => ({
      dimensionId,
      label,
      confidence: 0.8,
      confidenceBand: "high",
      status: "available",
      score,
      levels,
      probabilities: levels.map((level) => ({
        ...level,
        probability: level.score === score ? 1 : 0,
      })),
    })),
    derivedSignals: {
      interactionBalance: {
        status: "available",
        value: 100,
        label: "互动平衡度",
        confidenceBand: "high",
      },
    },
    interactionIndex: {
      status: "available",
      value: 66,
      label: "综合互动指数",
      confidenceBand: "high",
      includedComponents: [
        { componentId: "engagement_mean", effectiveWeight: 0.25 },
        { componentId: "warmth_mean", effectiveWeight: 0.25 },
        { componentId: "responsiveness_coordination", effectiveWeight: 0.25 },
        { componentId: "future_orientation", effectiveWeight: 0.25 },
      ],
    },
    analysisContext: "signed.test.context",
    meta: {
      requestId: "11111111-1111-4111-8111-111111111111",
      messageCount: 8,
      modelVersions: { typesafe: "jev-test" },
      analysisRulesetVersion: "2026-09-21.v1",
      explanationPolicyVersion: "2026-09-21.v1",
      analysisContextExpiresAt: Math.floor(Date.now() / 1000) + 600,
    },
  };
}

function explanationPayload() {
  return {
    relationshipExplanation: {
      headline: "这是一段围绕共同任务展开的协调互动",
      overview: "双方都在接续任务信息，互动节奏清楚。",
      classificationExplanation: "工作或学校场景的匹配分布最集中，但这仍只是当前片段的模型匹配。",
      confidenceExplanation: "集中度描述分布是否集中，不等于答案正确率。",
      dimensionInterpretations: [
        {
          dimensionId: "responsiveness_coordination",
          evidence: [
            { messageId: "m-0001", excerpt: "早上好，今天一起核对活动清单吗？", truncated: false },
            { messageId: "m-0002", excerpt: "可以，我十点前整理好。", truncated: false },
          ],
          explanation: "双方围绕同一任务持续接住彼此的信息。",
        },
      ],
      uncertainties: ["片段较短，无法代表长期互动模式。"],
      caveats: ["以下内容不代表现实关系事实。"],
    },
    meta: {
      requestId: "22222222-2222-4222-8222-222222222222",
      messageCount: 8,
      modelVersions: { llm: "deepseek-test" },
      analysisRulesetVersion: "2026-09-21.v1",
      explanationPolicyVersion: "2026-09-21.v1",
    },
  };
}

async function reachConsent(page: Page, meId: "a" | "b" = "b") {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const input = page.getByLabel("聊天记录");
  await input.fill(CHAT);
  await input.press("Control+Enter");
  await expect(page.getByRole("heading", { name: "确认消息和身份" })).toBeVisible();
  const identityOptions = page.getByRole("radio");
  await expect(identityOptions).toHaveCount(2);
  await expect(identityOptions.nth(0)).not.toBeChecked();
  await expect(identityOptions.nth(1)).not.toBeChecked();
  if (meId === "b") {
    await page.getByRole("button", { name: "开始分析" }).click();
    await expect(page.getByText("请选择 A 或 B，确认哪位是你。")).toBeVisible();
    await expect(identityOptions.nth(0)).toBeFocused();
  }
  const selected = page.locator(`input[name="identity-me"][value="${meId}"]`);
  await selected.focus();
  await page.keyboard.press("Space");
  await expect(selected).toBeChecked();
  await expect(page.getByText(
    meId === "a"
      ? "已确认：A（小岚）是我，B（阿澄）是对方。"
      : "已确认：A（小岚）是对方，B（阿澄）是我。",
  )).toBeVisible();

  const consent = page.getByRole("checkbox");
  await consent.focus();
  await page.keyboard.press("Space");
  await expect(consent).toBeChecked();
}

async function startWithKeyboard(page: Page) {
  const start = page.getByRole("button", { name: "开始分析" });
  await start.focus();
  await page.keyboard.press("Enter");
}

test("键盘完成本地预览、两阶段分析并展示可追溯解读", async ({ page }) => {
  await page.route("**/api/analyze/signals", (route) => {
    expect(route.request().postDataJSON().participants).toEqual({ meId: "b", otherId: "a" });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(signalsPayload()) });
  });
  await page.route("**/api/analyze/explanation", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(explanationPayload()) }),
  );

  await reachConsent(page);
  await startWithKeyboard(page);

  await expect(page.getByRole("heading", { name: "当前片段中的互动轮廓" })).toBeVisible();
  await expect(page.getByText("本报告中，A（小岚）代表对方，B（阿澄）代表我。")).toBeVisible();
  await expect(page.getByRole("heading", { name: "这是一段围绕共同任务展开的协调互动" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 5, name: "回应协调" })).toBeVisible();
  await expect(page.getByText("消息证据 · m-0001")).toBeVisible();
  await expect(page.getByText("消息证据 · m-0001").locator("..")).toContainText("A（对方）：");
  await expect(page.getByText("消息证据 · m-0002").locator("..")).toContainText("B（我）：");
  await expect(page.locator(".interpretation-scope")).toHaveText(["整体互动："]);
  await expect(page.getByRole("heading", { level: 4 })).toHaveText([
    "A（对方）的分析",
    "B（我）的分析",
    "整体互动分析",
  ]);
  await expect(page.getByRole("region", { name: "A（对方）的分析" })).toContainText(
    "本次解读未单独展开 A 的关键维度。",
  );
  await expect(page.getByRole("region", { name: "B（我）的分析" })).toContainText(
    "本次解读未单独展开 B 的关键维度。",
  );
  await expect(page.getByText("产品内部的解释性指标，不代表关系质量或真实好感概率。")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByText("本报告中，A（小岚）代表对方，B（阿澄）代表我。")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
});

test("关系解读失败时保留互动结果并可单独重试", async ({ page }) => {
  let explanationAttempts = 0;
  await page.route("**/api/analyze/signals", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(signalsPayload()) }),
  );
  await page.route("**/api/analyze/explanation", (route) => {
    explanationAttempts += 1;
    if (explanationAttempts === 1) {
      return route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "UPSTREAM_INVALID_RESPONSE",
            message: "关系解读暂时生成失败。",
            requestId: "33333333-3333-4333-8333-333333333333",
          },
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(explanationPayload()),
    });
  });

  await reachConsent(page, "a");
  await startWithKeyboard(page);

  await expect(page.getByRole("heading", { name: "当前片段中的互动轮廓" })).toBeVisible();
  await expect(page.getByText("本报告中，A（小岚）代表我，B（阿澄）代表对方。")).toBeVisible();
  const retry = page.getByRole("button", { name: "重新生成解读" });
  await expect(retry).toBeVisible();
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "这是一段围绕共同任务展开的协调互动" })).toBeVisible();
  expect(explanationAttempts).toBe(2);
});

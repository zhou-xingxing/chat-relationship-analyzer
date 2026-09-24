import { describe, expect, it } from "vitest";

import {
  BroadChoiceResultSchema,
  DIMENSION_IDS,
  DimensionResultSchema,
  ExplanationResponseSchema,
  RelationshipClassificationSchema,
  RELATIONSHIP_BROAD_IDS,
  RELATIONSHIP_SUBTYPE_IDS_BY_BROAD_ID,
  SignalAnalysisRequestSchema,
} from "@/lib/contracts/analysis";

const broadProbabilities = RELATIONSHIP_BROAD_IDS.map((id, index) => ({
  id,
  label: id,
  probability: [0.4, 0.2, 0.1, 0.1, 0.05, 0.05, 0.05, 0.05][index] ?? 0,
}));

const validBroadChoice = {
  selectedId: "romantic_or_partner",
  selectedLabel: "romantic_or_partner",
  summary: "当前最符合「romantic_or_partner」",
  confidenceBand: "medium",
  probabilities: broadProbabilities,
  confidence: 0.72,
};

const dimensionLevels = [0, 1, 2, 3, 4].map((score) => ({
  score,
  label: `等级 ${score}`,
}));
const dimensionProbabilities = [0.05, 0.1, 0.2, 0.5, 0.15].map(
  (probability, score) => ({ score, label: `等级 ${score}`, probability }),
);

describe("Choice 契约", () => {
  it("要求主导场景概率完整、唯一、和为一且选中最高项", () => {
    expect(BroadChoiceResultSchema.safeParse(validBroadChoice).success).toBe(true);
    expect(
      BroadChoiceResultSchema.safeParse({ ...validBroadChoice, summary: undefined })
        .success,
    ).toBe(false);

    expect(
      BroadChoiceResultSchema.safeParse({
        ...validBroadChoice,
        selectedId: "friendship",
        selectedLabel: "friendship",
      }).success,
    ).toBe(false);
    expect(
      BroadChoiceResultSchema.safeParse({
        ...validBroadChoice,
        probabilities: broadProbabilities.slice(0, -1),
      }).success,
    ).toBe(false);
  });

  it("要求细分选项与当前主导场景严格对应", () => {
    const friendshipSubtypeIds = RELATIONSHIP_SUBTYPE_IDS_BY_BROAD_ID.friendship;
    const classification = {
      broad: validBroadChoice,
      subtype: {
        status: "available",
        result: {
          selectedId: "close_friend",
          selectedLabel: "close_friend",
          summary: "当前最符合「close_friend」",
          confidenceBand: "medium",
          probabilities: friendshipSubtypeIds.map((id, index) => ({
            id,
            label: id,
            probability: [0.4, 0.2, 0.15, 0.15, 0.1][index] ?? 0,
          })),
          confidence: 0.7,
        },
      },
      notGroundTruth: true,
    };

    expect(RelationshipClassificationSchema.safeParse(classification).success).toBe(
      false,
    );
  });
});

describe("互动维度契约", () => {
  const validDimension = {
    dimensionId: "support_care",
    label: "支持关怀",
    confidence: 0.8,
    confidenceBand: "high",
    status: "available",
    score: 3,
    levels: dimensionLevels,
    probabilities: dimensionProbabilities,
  };

  it("要求五级量表完整，且得分属于最高概率等级", () => {
    expect(DimensionResultSchema.safeParse(validDimension).success).toBe(true);
    expect(
      DimensionResultSchema.safeParse({
        ...validDimension,
        confidenceBand: undefined,
      }).success,
    ).toBe(false);
    expect(
      DimensionResultSchema.safeParse({ ...validDimension, score: 2 }).success,
    ).toBe(false);
    expect(
      DimensionResultSchema.safeParse({
        ...validDimension,
        levels: dimensionLevels.map((level) => ({ ...level, score: 0 })),
      }).success,
    ).toBe(false);
  });

  it("证据不足分支拒绝泄漏得分和概率", () => {
    expect(
      DimensionResultSchema.safeParse({
        dimensionId: "support_care",
        label: "支持关怀",
        confidence: 0.2,
        status: "insufficient_evidence",
      }).success,
    ).toBe(true);
    expect(
      DimensionResultSchema.safeParse({
        dimensionId: "support_care",
        label: "支持关怀",
        confidence: 0.2,
        status: "insufficient_evidence",
        confidenceBand: "medium",
        score: 0,
      }).success,
    ).toBe(false);
  });
});

describe("两阶段公开契约", () => {
  const message = {
    id: "m-0001",
    senderId: "a",
    timestamp: "2026-09-18T09:00:00+08:00",
    kind: "text",
    text: "测试消息",
  };

  it("请求拒绝未知字段、重复消息 ID 或缺失参与者消息", () => {
    expect(
      SignalAnalysisRequestSchema.safeParse({
        participants: { meId: "a", otherId: "b" },
        messages: [message, { ...message, senderId: "b" }],
      }).success,
    ).toBe(false);
    expect(
      SignalAnalysisRequestSchema.safeParse({
        participants: { meId: "a", otherId: "b" },
        messages: [message],
        clientScore: 99,
      }).success,
    ).toBe(false);
  });

  it("解释响应限制关键维度唯一，并按 code point 限制摘录长度", () => {
    const interpretation = {
      dimensionId: DIMENSION_IDS[0],
      evidence: [
        { messageId: "m-0001", excerpt: "😀".repeat(500), truncated: true },
      ],
      explanation: "这是一段解释。",
    };
    const response = {
      relationshipExplanation: {
        headline: "当前互动概览",
        overview: "概览",
        classificationExplanation: "分类解释",
        confidenceExplanation: "置信度解释",
        dimensionInterpretations: [interpretation],
        uncertainties: [],
        caveats: [],
      },
      meta: {
        requestId: "request-1",
        messageCount: 8,
        modelVersions: { llm: "deepseek-flash" },
        analysisRulesetVersion: "v1",
        explanationPolicyVersion: "v1",
      },
    };

    expect(ExplanationResponseSchema.safeParse(response).success).toBe(true);
    expect(
      ExplanationResponseSchema.safeParse({
        ...response,
        relationshipExplanation: {
          ...response.relationshipExplanation,
          dimensionInterpretations: [
            interpretation,
            { ...interpretation, evidence: [{ ...interpretation.evidence[0], excerpt: "😀".repeat(501) }] },
          ],
        },
      }).success,
    ).toBe(false);
  });
});

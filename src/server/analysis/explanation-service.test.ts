import { describe, expect, it, vi } from "vitest";

import type { SignalAnalysisRequest } from "@/lib/contracts/analysis";
import type { LlmClient } from "@/server/llm/client";
import type { TypeSafeClient, TypeSafePrimaryResult } from "@/server/typesafe/client";
import { BROAD_OPTIONS, DIMENSION_DEFINITIONS } from "./ruleset";
import { analyzeSignals } from "./signals-service";
import { createEvidenceExcerpt, generateExplanation } from "./explanation-service";

const secret = "test-only-analysis-context-secret";
const signalRequest: SignalAnalysisRequest = {
  participants: { meId: "a", otherId: "b" },
  messages: Array.from({ length: 8 }, (_, index) => ({
    id: `m${index + 1}`,
    senderId: index % 2 === 0 ? "a" : "b",
    timestamp: `2026-09-${String(index + 1).padStart(2, "0")}T12:00:00+08:00`,
    kind: "text",
    text: index === 0 ? "甲".repeat(501) : `虚构消息 ${index + 1}`,
  })),
};

function primaryResult(): TypeSafePrimaryResult {
  return {
    model: "jev-1.13.0",
    broad: {
      selectedId: "unclear",
      confidence: 0.3,
      probabilities: BROAD_OPTIONS.map(({ id }) => ({
        id,
        probability: id === "unclear" ? 0.3 : 0.7 / 7,
      })),
    },
    dimensions: DIMENSION_DEFINITIONS.map(({ id }) => ({
      dimensionId: id,
      score: 2,
      confidence: 0.8,
      probabilities: [0, 1, 2, 3, 4].map((score) => ({
        score: score as 0 | 1 | 2 | 3 | 4,
        probability: score === 2 ? 1 : 0,
      })),
    })),
  };
}

async function createSignedContext() {
  const typesafeClient: TypeSafeClient = {
    analyzePrimary: vi.fn().mockResolvedValue(primaryResult()),
    analyzeSubtype: vi.fn(),
  };
  return analyzeSignals(signalRequest, {
    typesafeClient,
    contextSecret: secret,
    nowMs: () => 1_000_000,
    requestId: () => "signals-request",
  });
}

describe("关系解读服务", () => {
  it("验证签名上下文并按合法消息 ID 回填、截断证据原文", async () => {
    const signals = await createSignedContext();
    const llmClient: LlmClient = {
      model: "deepseek-test",
      generateExplanation: vi.fn().mockResolvedValue({
        headline: "当前互动片段",
        overview: "基于既有结果的说明。",
        classificationExplanation: "当前线索不足，不能确认现实关系。",
        confidenceExplanation: "置信度只表示分布集中程度。",
        dimensionInterpretations: [
          {
            dimensionId: "a_engagement",
            messageIds: ["m1"],
            explanation: "该消息体现了当前片段中的投入信号。",
          },
        ],
        uncertainties: ["样本有限"],
        caveats: ["不代表现实关系事实"],
      }),
    };
    const response = await generateExplanation(
      { ...signalRequest, analysisContext: signals.analysisContext },
      {
        llmClient,
        contextSecret: secret,
        nowMs: () => 1_100_000,
        requestId: () => "explanation-request",
      },
    );

    const evidence = response.relationshipExplanation.dimensionInterpretations[0].evidence[0];
    expect(Array.from(evidence.excerpt)).toHaveLength(500);
    expect(evidence.truncated).toBe(true);
    expect(response.meta.modelVersions.llm).toBe("deepseek-test");
  });

  it("消息变化统一映射为上下文不可用且不调用 LLM", async () => {
    const signals = await createSignedContext();
    const llmClient: LlmClient = {
      model: "deepseek-test",
      generateExplanation: vi.fn(),
    };
    const changedMessages = signalRequest.messages.map((message, index) =>
      index === 1 ? { ...message, text: "被改变的消息" } : message,
    );
    await expect(
      generateExplanation(
        {
          participants: signalRequest.participants,
          messages: changedMessages,
          analysisContext: signals.analysisContext,
        },
        { llmClient, contextSecret: secret, nowMs: () => 1_100_000 },
      ),
    ).rejects.toMatchObject({
      code: "ANALYSIS_CONTEXT_UNAVAILABLE",
      status: 400,
      internalReason: "context_message_digest_mismatch",
    });
    expect(llmClient.generateExplanation).not.toHaveBeenCalled();
  });

  it("按 Unicode code point 而不是 UTF-16 单元截断", () => {
    const excerpt = createEvidenceExcerpt(`${"🙂".repeat(500)}尾`);
    expect(Array.from(excerpt.excerpt)).toHaveLength(500);
    expect(excerpt.truncated).toBe(true);
  });
});

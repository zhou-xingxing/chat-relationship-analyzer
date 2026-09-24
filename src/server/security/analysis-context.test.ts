import { describe, expect, it } from "vitest";

import type { AnalysisContextPayload } from "@/lib/contracts/analysis";
import type { ChatMessage, Participants } from "@/lib/contracts/chat";
import {
  ANALYSIS_RULESET_VERSION,
  BROAD_OPTIONS,
  DIMENSION_DEFINITIONS,
  EXPLANATION_POLICY_VERSION,
} from "@/server/analysis/ruleset";
import { applyDimensionConfidence } from "@/server/analysis/scoring";
import { computeDeterministicMetrics } from "@/server/analysis/deterministic-metrics";
import { createMessageDigest } from "./message-digest";
import {
  AnalysisContextUnavailableError,
  signAnalysisContext,
  verifyAnalysisContext,
} from "./analysis-context";

const secret = "test-only-analysis-context-secret-32-bytes";
const participants: Participants = { meId: "a", otherId: "b" };
const messages: ChatMessage[] = Array.from({ length: 8 }, (_, index) => ({
  id: `m${index + 1}`,
  senderId: index % 2 === 0 ? "a" : "b",
  timestamp: `2026-09-${String(index + 1).padStart(2, "0")}T12:00:00+08:00`,
  kind: "text",
  text: `虚构消息 ${index + 1}`,
}));

function payload(overrides: Partial<AnalysisContextPayload> = {}): AnalysisContextPayload {
  const dimensions = DIMENSION_DEFINITIONS.map(({ id }) =>
    applyDimensionConfidence({
      dimensionId: id,
      score: 2,
      confidence: 0.8,
      probabilities: [0, 1, 2, 3, 4].map((score) => ({
        score: score as 0 | 1 | 2 | 3 | 4,
        probability: score === 2 ? 1 : 0,
      })),
    }),
  );
  return {
    version: 1,
    issuedAt: 1_000,
    expiresAt: 1_600,
    participants,
    messageDigest: createMessageDigest(participants, messages),
    deterministicMetrics: computeDeterministicMetrics(messages),
    relationshipClassification: {
      broad: {
        selectedId: "friendship",
        selectedLabel: "朋友",
        summary: "当前片段与「朋友」的匹配信号较集中",
        confidenceBand: "high",
        probabilities: BROAD_OPTIONS.map((item) => ({
          ...item,
          probability: item.id === "friendship" ? 1 : 0,
        })),
        confidence: 1,
      },
      subtype: { status: "skipped", reason: "low_confidence" },
      notGroundTruth: true,
    },
    dimensions,
    derivedSignals: {
      interactionBalance: {
        status: "available",
        value: 100,
        label: "互动平衡度",
        confidenceBand: "high",
      },
    },
    interactionIndex: {
      status: "insufficient_evidence",
      value: null,
      confidenceBand: null,
      includedComponents: [],
    },
    modelVersions: { typesafe: "jev-1.13.0" },
    analysisRulesetVersion: ANALYSIS_RULESET_VERSION,
    explanationPolicyVersion: EXPLANATION_POLICY_VERSION,
    ...overrides,
  };
}

describe("签名分析上下文", () => {
  it("验签正常上下文并拒绝篡改、过期与消息不匹配", () => {
    const token = signAnalysisContext(payload(), secret);
    expect(
      verifyAnalysisContext({ token, participants, messages, nowSeconds: 1_200, secret }),
    ).toMatchObject({ version: 1, messageDigest: createMessageDigest(participants, messages) });

    const [body, signature] = token.split(".");
    expect(() =>
      verifyAnalysisContext({
        token: `${body.slice(0, -1)}A.${signature}`,
        participants,
        messages,
        nowSeconds: 1_200,
        secret,
      }),
    ).toThrow(AnalysisContextUnavailableError);
    expect(() =>
      verifyAnalysisContext({ token, participants, messages, nowSeconds: 1_600, secret }),
    ).toThrowError(expect.objectContaining({ reason: "expired" }));
    expect(() =>
      verifyAnalysisContext({
        token,
        participants,
        messages: messages.map((message, index) =>
          index === 0 ? { ...message, text: "被修改" } : message,
        ),
        nowSeconds: 1_200,
        secret,
      }),
    ).toThrowError(expect.objectContaining({ reason: "message_digest_mismatch" }));
  });

  it("拒绝当前服务不支持的规则版本", () => {
    const token = signAnalysisContext(payload({ analysisRulesetVersion: "legacy" }), secret);
    expect(() =>
      verifyAnalysisContext({ token, participants, messages, nowSeconds: 1_200, secret }),
    ).toThrowError(expect.objectContaining({ reason: "unsupported_analysis_ruleset" }));

    const policyToken = signAnalysisContext(
      payload({ explanationPolicyVersion: "legacy" }),
      secret,
    );
    expect(() =>
      verifyAnalysisContext({
        token: policyToken,
        participants,
        messages,
        nowSeconds: 1_200,
        secret,
      }),
    ).toThrowError(expect.objectContaining({ reason: "unsupported_explanation_policy" }));
  });
});

import { describe, expect, it, vi } from "vitest";

import type { SignalAnalysisRequest } from "@/lib/contracts/analysis";
import { BROAD_OPTIONS, DIMENSION_DEFINITIONS } from "./ruleset";
import type { TypeSafeClient, TypeSafePrimaryResult } from "@/server/typesafe/client";
import { UpstreamError } from "@/server/upstream-error";
import { analyzeSignals } from "./signals-service";

const request: SignalAnalysisRequest = {
  participants: { meId: "a", otherId: "b" },
  messages: Array.from({ length: 8 }, (_, index) => ({
    id: `m${index + 1}`,
    senderId: index % 2 === 0 ? "a" : "b",
    timestamp: `2026-09-${String(index + 1).padStart(2, "0")}T12:00:00+08:00`,
    kind: "text",
    text: `虚构消息 ${index + 1}`,
  })),
};

function primaryResult(): TypeSafePrimaryResult {
  return {
    model: "jev-1.13.0",
    broad: {
      selectedId: "friendship",
      confidence: 0.9,
      probabilities: BROAD_OPTIONS.map(({ id }) => ({
        id,
        probability: id === "friendship" ? 0.8 : id === "unclear" ? 0.1 : 0.1 / 6,
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

describe("互动信号服务", () => {
  it("细分失败时保留主分类、十维度、派生指标和签名上下文", async () => {
    const client: TypeSafeClient = {
      analyzePrimary: vi.fn().mockResolvedValue(primaryResult()),
      analyzeSubtype: vi.fn().mockRejectedValue(new UpstreamError("typesafe", "timeout")),
    };
    const response = await analyzeSignals(request, {
      typesafeClient: client,
      contextSecret: "test-context-secret",
      nowMs: () => 1_000_000,
      requestId: () => "request-1",
    });

    expect(response.relationshipClassification.broad.selectedId).toBe("friendship");
    expect(response.relationshipClassification.broad).toMatchObject({
      summary: "当前片段与「朋友」的匹配信号较集中",
      confidenceBand: "high",
    });
    expect(response.relationshipClassification.subtype).toEqual({
      status: "temporarily_unavailable",
    });
    expect(response.dimensions).toHaveLength(10);
    expect(response.derivedSignals.interactionBalance.status).toBe("available");
    expect(response.analysisContext).toContain(".");
    expect(response.meta.analysisContextExpiresAt).toBe(1_600);
  });

  it("剩余总预算不足时不调用细分并直接降级", async () => {
    const client: TypeSafeClient = {
      analyzePrimary: vi.fn().mockResolvedValue(primaryResult()),
      analyzeSubtype: vi.fn(),
    };
    const times = [0, 50_000, 50_000];
    const response = await analyzeSignals(request, {
      typesafeClient: client,
      contextSecret: "test-context-secret",
      nowMs: () => times.shift() ?? 50_000,
      requestId: () => "request-2",
    });
    expect(client.analyzeSubtype).not.toHaveBeenCalled();
    expect(response.relationshipClassification.subtype.status).toBe(
      "temporarily_unavailable",
    );
  });

  it("为可用细分返回服务端确定的摘要与置信度档位", async () => {
    const client: TypeSafeClient = {
      analyzePrimary: vi.fn().mockResolvedValue(primaryResult()),
      analyzeSubtype: vi.fn().mockResolvedValue({
        model: "jev-1.13.0",
        subtype: {
          selectedId: "close_friend",
          confidence: 0.72,
          probabilities: [
            { id: "close_friend", probability: 0.6 },
            { id: "ordinary_friend", probability: 0.2 },
            { id: "new_friend", probability: 0.1 },
            { id: "reconnecting_friend", probability: 0.05 },
            { id: "friendship_unclear", probability: 0.05 },
          ],
        },
      }),
    };
    const response = await analyzeSignals(request, {
      typesafeClient: client,
      contextSecret: "test-context-secret",
      nowMs: () => 1_000_000,
      requestId: () => "request-3",
    });

    expect(response.relationshipClassification.subtype).toMatchObject({
      status: "available",
      result: {
        summary: "当前最符合「亲密朋友」",
        confidenceBand: "medium",
      },
    });
  });

  it("主分析超时映射为统一服务错误", async () => {
    const client: TypeSafeClient = {
      analyzePrimary: vi.fn().mockRejectedValue(new UpstreamError("typesafe", "timeout")),
      analyzeSubtype: vi.fn(),
    };
    await expect(
      analyzeSignals(request, { typesafeClient: client, contextSecret: "test" }),
    ).rejects.toMatchObject({ code: "UPSTREAM_TIMEOUT", status: 504 });
  });
});

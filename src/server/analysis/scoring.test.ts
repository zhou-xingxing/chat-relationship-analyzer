import { describe, expect, it } from "vitest";

import { DIMENSION_DEFINITIONS } from "./ruleset";
import {
  applyDimensionConfidence,
  computeInteractionBalance,
  computeInteractionIndex,
  type TrustedDimensionAssessment,
} from "./scoring";

function assessment(
  dimensionId: TrustedDimensionAssessment["dimensionId"],
  score: TrustedDimensionAssessment["score"],
  confidence = 0.8,
): TrustedDimensionAssessment {
  return {
    dimensionId,
    score,
    confidence,
    probabilities: [0, 1, 2, 3, 4].map((value) => ({
      score: value as 0 | 1 | 2 | 3 | 4,
      probability: value === score ? 1 : 0,
    })),
  };
}

describe("可信评分", () => {
  it("计算互动平衡度与重新归一化后的综合互动指数", () => {
    const scores = {
      a_engagement: 4,
      b_engagement: 2,
      a_warmth: 3,
      b_warmth: 1,
      responsiveness_coordination: 4,
      self_disclosure: 2,
      support_care: 3,
      future_orientation: 1,
      tension_hostility: 0,
      power_asymmetry: 0,
    } as const;
    const dimensions = DIMENSION_DEFINITIONS.map(({ id }) =>
      applyDimensionConfidence(assessment(id, scores[id])),
    );

    expect(computeInteractionBalance(dimensions)).toEqual({
      status: "available",
      value: 50,
      label: "互动平衡度",
      confidenceBand: "high",
    });
    const index = computeInteractionIndex(dimensions);
    expect(index.status).toBe("available");
    if (index.status === "available") {
      expect(index.value).toBe(66);
      expect(index.includedComponents).toHaveLength(6);
      expect(
        index.includedComponents.reduce((sum, item) => sum + item.effectiveWeight, 0),
      ).toBeCloseTo(1);
    }
  });

  it("区分高置信度零分与证据不足，并在组件不足时不返回指数", () => {
    const availableIds = new Set([
      "responsiveness_coordination",
      "self_disclosure",
      "support_care",
    ]);
    const dimensions = DIMENSION_DEFINITIONS.map(({ id }) =>
      applyDimensionConfidence(assessment(id, 0, availableIds.has(id) ? 0.8 : 0.44)),
    );
    expect(dimensions[4]).toMatchObject({ status: "available", score: 0 });
    expect(applyDimensionConfidence(assessment("future_orientation", 2, 0.7))).toMatchObject({
      status: "available",
      confidenceBand: "medium",
    });
    expect(dimensions[0]).toMatchObject({ status: "insufficient_evidence" });
    expect(computeInteractionBalance(dimensions)).toEqual({
      status: "insufficient_evidence",
      value: null,
      confidenceBand: null,
    });
    expect(computeInteractionIndex(dimensions)).toEqual({
      status: "insufficient_evidence",
      value: null,
      confidenceBand: null,
      includedComponents: [],
    });
  });
});

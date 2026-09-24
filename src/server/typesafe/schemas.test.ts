import { describe, expect, it } from "vitest";

import { discretizeTypeSafeScore, parseChoiceAnswer, parseScoreAnswer } from "./schemas";

describe("TypeSafe 响应适配", () => {
  it("按最高概率、raw score 距离、较小等级的顺序离散化 Score", () => {
    const probabilities = { "0": 0, "1": 0.4, "2": 0.1, "3": 0.4, "4": 0.1 };
    expect(discretizeTypeSafeScore(2.8, probabilities)).toBe(3);
    expect(discretizeTypeSafeScore(2, probabilities)).toBe(1);
  });

  it("校验 Choice 与五级 Score 的完整概率分布", () => {
    expect(
      parseChoiceAnswer(
        {
          type: "choice",
          choice: "a",
          confidence: 0.7,
          probabilities: { a: 0.7, b: 0.3 },
        },
        ["a", "b"] as const,
      ).selectedId,
    ).toBe("a");
    expect(
      parseScoreAnswer({
        type: "score",
        score: 2.4,
        confidence: 0.6,
        legend: { "0": "0", "1": "1", "2": "2", "3": "3", "4": "4" },
        probabilities: { "0": 0, "1": 0.1, "2": 0.6, "3": 0.3, "4": 0 },
      }).score,
    ).toBe(2);
  });

  it("拒绝缺项、概率和错误或非最高概率选择", () => {
    expect(() =>
      parseChoiceAnswer(
        {
          type: "choice",
          choice: "b",
          confidence: 0.7,
          probabilities: { a: 0.8, b: 0.2 },
        },
        ["a", "b"] as const,
      ),
    ).toThrow();
    expect(() =>
      parseScoreAnswer({
        type: "score",
        score: 2,
        confidence: 0.6,
        legend: { "0": "0", "1": "1", "2": "2", "3": "3", "4": "4" },
        probabilities: { "0": 0, "1": 0.1, "2": 0.6, "3": 0.1, "4": 0 },
      }),
    ).toThrow();
  });
});

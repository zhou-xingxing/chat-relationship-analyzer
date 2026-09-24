import { describe, expect, it } from "vitest";

import { getChoiceDisplaySemantics } from "./ruleset";

describe("Choice 公开显示语义", () => {
  it.each([
    [0.39, "insufficient", "当前线索不足，暂时无法判断"],
    [0.4, "low", "当前更接近「朋友」，但线索还不够统一"],
    [0.649, "low", "当前更接近「朋友」，但线索还不够统一"],
    [0.65, "medium", "当前最符合「朋友」"],
    [0.85, "medium", "当前最符合「朋友」"],
    [0.851, "high", "当前片段与「朋友」的匹配信号较集中"],
  ] as const)("置信度 %s 映射为 %s", (confidence, confidenceBand, summary) => {
    expect(getChoiceDisplaySemantics("朋友", confidence)).toEqual({
      summary,
      confidenceBand,
    });
  });
});

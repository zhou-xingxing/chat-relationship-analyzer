import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@/lib/contracts/chat";
import { parseAndValidateExplanationOutput } from "./schemas";

const messages: ChatMessage[] = [
  {
    id: "m1",
    senderId: "a",
    timestamp: "2026-09-01T12:00:00+08:00",
    kind: "text",
    text: "虚构消息一",
  },
  {
    id: "m2",
    senderId: "b",
    timestamp: "2026-09-01T12:01:00+08:00",
    kind: "text",
    text: "虚构消息二",
  },
];

function modelOutput(overrides: Record<string, unknown> = {}) {
  return {
    headline: "当前互动片段",
    overview: "仅解释已有结果。",
    classificationExplanation: "这是对当前聊天场景的模型匹配结果。",
    confidenceExplanation: "置信度表示模型分布是否集中。",
    dimensionInterpretations: [
      {
        dimensionId: "a_engagement",
        messageIds: ["m1"],
        explanation: "可观察到投入信号。",
      },
    ],
    uncertainties: ["样本有限"],
    caveats: ["不代表现实关系事实"],
    ...overrides,
  };
}

describe("解读模型输出归一化", () => {
  it("把 uncertainties/caveats 的单个字符串归一化为单元素数组", () => {
    const output = parseAndValidateExplanationOutput(
      modelOutput({ uncertainties: "样本有限", caveats: "不代表现实关系事实" }),
      messages,
    );

    expect(output.uncertainties).toEqual(["样本有限"]);
    expect(output.caveats).toEqual(["不代表现实关系事实"]);
  });

  it("把空字符串归一化为空数组", () => {
    const output = parseAndValidateExplanationOutput(
      modelOutput({ uncertainties: "   ", caveats: "" }),
      messages,
    );

    expect(output.uncertainties).toEqual([]);
    expect(output.caveats).toEqual([]);
  });

  it("把单个 messageId 字符串归一化为数组", () => {
    const output = parseAndValidateExplanationOutput(
      modelOutput({
        dimensionInterpretations: [
          {
            dimensionId: "a_engagement",
            messageIds: "m1",
            explanation: "可观察到投入信号。",
          },
        ],
      }),
      messages,
    );

    expect(output.dimensionInterpretations[0]?.messageIds).toEqual(["m1"]);
  });

  it("只归一化格式，不放过真正不合法的结构", () => {
    expect(() =>
      parseAndValidateExplanationOutput(modelOutput({ uncertainties: 42 }), messages),
    ).toThrow();

    expect(() =>
      parseAndValidateExplanationOutput(modelOutput({ uncertainties: [""] }), messages),
    ).toThrow();

    expect(() =>
      parseAndValidateExplanationOutput(
        modelOutput({
          dimensionInterpretations: [
            {
              dimensionId: "a_engagement",
              messageIds: "m404",
              explanation: "引用了不存在的消息。",
            },
          ],
        }),
        messages,
      ),
    ).toThrow("维度解释引用了不存在的消息");
  });
});

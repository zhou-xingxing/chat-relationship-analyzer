import { describe, expect, it } from "vitest";

import type { AnalysisContextPayload } from "@/lib/contracts/analysis";
import type { ChatMessage } from "@/lib/contracts/chat";
import {
  EXPLANATION_SYSTEM_PROMPT,
  buildExplanationUserPrompt,
  buildRepairPrompt,
} from "./prompt";
import { RelationshipExplanationModelOutputSchema } from "./schemas";

type JsonTypeName = "string" | "array";

interface ZodDefLike {
  type: string;
  out?: unknown;
}

/**
 * 取字段对外声明的 JSON 类型。z.preprocess 会被包成 pipe，以输出端 schema 为准。
 */
function declaredJsonTypeOf(schema: unknown): JsonTypeName {
  const def = (schema as { def: ZodDefLike }).def;
  const effective =
    def.type === "pipe" ? (def.out as { def: ZodDefLike }).def : def;
  if (effective.type !== "string" && effective.type !== "array") {
    throw new Error(`未覆盖的顶层字段类型：${effective.type}`);
  }
  return effective.type;
}

/** 解析系统提示词里 `- 字段名: 类型说明` 形式的输出字段声明。 */
function parseDeclaredFields(prompt: string): Map<string, string> {
  const declared = new Map<string, string>();
  for (const line of prompt.split("\n")) {
    const match = /^- ([A-Za-z][A-Za-z0-9]*): (.+)$/.exec(line.trim());
    if (match?.[1] && match[2]) {
      declared.set(match[1], match[2].trim());
    }
  }
  return declared;
}

describe("解读提示词", () => {
  it("压缩重复量表，保留完整聊天与每个维度的概率", () => {
    const text = "虚构聊天内容".repeat(200);
    const messages: ChatMessage[] = [
      {
        id: "m-0001",
        senderId: "a",
        timestamp: "2026-09-22T12:00:00+08:00",
        kind: "text",
        text,
      },
    ];
    const context = {
      deterministicMetrics: { messageCount: 1 },
      relationshipClassification: { broad: { selectedId: "unclear", confidence: 0.3 } },
      dimensions: [
        {
          dimensionId: "a_engagement",
          label: "A 的投入度",
          status: "available",
          confidence: 0.8,
          confidenceBand: "high",
          score: 2,
          levels: [
            { score: 0, label: "未观察到明显信号" },
            { score: 1, label: "少量或很弱的信号" },
          ],
          probabilities: [
            { score: 0, label: "未观察到明显信号", probability: 0.1 },
            { score: 1, label: "少量或很弱的信号", probability: 0.1 },
            { score: 2, label: "中等、但不完全一致的信号", probability: 0.6 },
            { score: 3, label: "较多且较一致的信号", probability: 0.1 },
            { score: 4, label: "强烈且持续的信号", probability: 0.1 },
          ],
        },
        {
          dimensionId: "b_warmth",
          label: "B 的表达温度",
          status: "insufficient_evidence",
          confidence: 0.2,
        },
      ],
      derivedSignals: { interactionBalance: { status: "insufficient_evidence" } },
      interactionIndex: { status: "insufficient_evidence" },
      analysisRulesetVersion: "test",
      explanationPolicyVersion: "test",
    } as unknown as AnalysisContextPayload;

    const prompt = buildExplanationUserPrompt(messages, context);
    const signed = JSON.parse(prompt.split("<SIGNED_ANALYSIS_RESULT>\n")[1].split("\n</SIGNED_ANALYSIS_RESULT>")[0]);
    const transcript = JSON.parse(prompt.split("<UNTRUSTED_CHAT_DATA>\n")[1].split("\n</UNTRUSTED_CHAT_DATA>")[0]);

    expect(transcript).toEqual(messages);
    expect(signed.scoreLevels).toHaveLength(5);
    expect(signed.dimensions[0]).toMatchObject({
      dimensionId: "a_engagement",
      status: "available",
      confidence: 0.8,
      score: 2,
      probabilities: [
        { score: 0, probability: 0.1 },
        { score: 1, probability: 0.1 },
        { score: 2, probability: 0.6 },
        { score: 3, probability: 0.1 },
        { score: 4, probability: 0.1 },
      ],
    });
    expect(signed.dimensions[0]).not.toHaveProperty("levels");
    expect(signed.dimensions[1]).toEqual({
      dimensionId: "b_warmth",
      label: "B 的表达温度",
      status: "insufficient_evidence",
      confidence: 0.2,
    });
  });

  it("修复提示不重复发送上一轮模型输出", () => {
    expect(buildRepairPrompt()).not.toContain("<INVALID_OUTPUT>");
  });
});

describe("解读提示词与输出 schema 的一致性", () => {
  it("系统提示词为 schema 的每个顶层字段声明了正确的 JSON 类型", () => {
    const declared = parseDeclaredFields(EXPLANATION_SYSTEM_PROMPT);
    const shape = RelationshipExplanationModelOutputSchema.shape;

    // 双向覆盖：schema 的字段提示词都要声明，提示词声明的字段也必须在 schema 里。
    expect(declared.size).toBe(Object.keys(shape).length);

    for (const [key, schema] of Object.entries(shape)) {
      const declaredType = declared.get(key);
      expect(declaredType, `系统提示词缺少字段 ${key} 的声明`).toBeDefined();
      const expected = declaredJsonTypeOf(schema);
      expect(
        declaredType!.startsWith(expected),
        `字段 ${key} 在提示词中声明为「${declaredType}」，但 schema 要求 ${expected}`,
      ).toBe(true);
    }

    for (const key of declared.keys()) {
      expect(
        Object.hasOwn(shape, key),
        `系统提示词声明了 schema 之外的字段 ${key}`,
      ).toBe(true);
    }
  });
});

import "server-only";

import { z } from "zod";

import { DimensionIdSchema, EVIDENCE_MAX_ITEMS } from "@/lib/contracts/analysis";
import type { ChatMessage } from "@/lib/contracts/chat";

/**
 * 模型偶尔把「字符串列表」字段写成单个字符串（只有一个元素时尤其常见）。
 * 这是纯格式差异，不涉及重新分类或重新评分，因此在校验层直接归一化，
 * 避免为了一个括号差异浪费一次修复重试。
 * 空字符串按「没有内容」处理，归一化为空数组。
 */
function toStringList(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? [] : [trimmed];
}

const stringList = (maxItems: number) =>
  z.preprocess(
    toStringList,
    z.array(z.string().trim().min(1).max(1_000)).max(maxItems),
  );

export const RelationshipExplanationModelOutputSchema = z
  .object({
    headline: z.string().trim().min(1).max(160),
    overview: z.string().trim().min(1).max(2_000),
    classificationExplanation: z.string().trim().min(1).max(2_000),
    confidenceExplanation: z.string().trim().min(1).max(2_000),
    dimensionInterpretations: z
      .array(
        z
          .object({
            dimensionId: DimensionIdSchema,
            messageIds: z.preprocess(
              toStringList,
              z.array(z.string().min(1)).min(1).max(EVIDENCE_MAX_ITEMS),
            ),
            explanation: z.string().trim().min(1).max(2_000),
          })
          .strict(),
      )
      .min(1)
      .max(10),
    uncertainties: stringList(10),
    caveats: stringList(10),
  })
  .strict();

export type RelationshipExplanationModelOutput = z.infer<
  typeof RelationshipExplanationModelOutputSchema
>;

export function parseAndValidateExplanationOutput(
  input: unknown,
  messages: readonly ChatMessage[],
): RelationshipExplanationModelOutput {
  const output = RelationshipExplanationModelOutputSchema.parse(input);
  const messageIds = new Set(messages.map((message) => message.id));
  const usedDimensions = new Set<string>();

  for (const interpretation of output.dimensionInterpretations) {
    if (usedDimensions.has(interpretation.dimensionId)) {
      throw new Error("维度解释存在重复维度");
    }
    usedDimensions.add(interpretation.dimensionId);

    const usedMessageIds = new Set<string>();
    for (const messageId of interpretation.messageIds) {
      if (!messageIds.has(messageId)) {
        throw new Error("维度解释引用了不存在的消息");
      }
      if (usedMessageIds.has(messageId)) {
        throw new Error("同一维度解释重复引用消息");
      }
      usedMessageIds.add(messageId);
    }
  }

  return output;
}

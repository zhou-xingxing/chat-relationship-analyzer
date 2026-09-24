import "server-only";

import { z } from "zod";

import type { DimensionScore } from "@/lib/contracts/chat";
import type { RelationshipBroadId, RelationshipSubtypeId } from "@/lib/contracts/analysis";
import { PROBABILITY_SUM_TOLERANCE } from "@/server/analysis/ruleset";

export const TypeSafeChoiceAnswerSchema = z
  .object({
    type: z.literal("choice"),
    choice: z.string().min(1),
    confidence: z.number().min(0).max(1),
    probabilities: z.record(z.string().min(1), z.number().min(0).max(1)),
  })
  .strict();

export const TypeSafeScoreAnswerSchema = z
  .object({
    type: z.literal("score"),
    score: z.number().min(0).max(4),
    confidence: z.number().min(0).max(1),
    legend: z.record(z.string(), z.string()),
    probabilities: z.record(z.string(), z.number().min(0).max(1)),
  })
  .strict();

const TypeSafeUsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  })
  .strict();

export const TypeSafeResponseEnvelopeSchema = z
  .object({
    model: z.string().min(1),
    answers: z.record(z.string(), z.unknown()),
    usage: TypeSafeUsageSchema,
  })
  .strict();

function assertProbabilityDistribution(probabilities: Record<string, number>): void {
  const sum = Object.values(probabilities).reduce((total, value) => total + value, 0);
  if (Math.abs(sum - 1) > PROBABILITY_SUM_TOLERANCE) {
    throw new Error("概率和不为 1");
  }
}

export function parseChoiceAnswer<TId extends string>(
  input: unknown,
  expectedIds: readonly TId[],
): { selectedId: TId; confidence: number; probabilities: Array<{ id: TId; probability: number }> } {
  const answer = TypeSafeChoiceAnswerSchema.parse(input);
  const actualIds = Object.keys(answer.probabilities);
  if (
    actualIds.length !== expectedIds.length ||
    expectedIds.some((id) => !Object.hasOwn(answer.probabilities, id))
  ) {
    throw new Error("Choice 选项集合不完整");
  }
  if (!expectedIds.includes(answer.choice as TId)) {
    throw new Error("Choice 选择不属于预期选项");
  }
  assertProbabilityDistribution(answer.probabilities);

  const selectedProbability = answer.probabilities[answer.choice];
  const maximumProbability = Math.max(...Object.values(answer.probabilities));
  if (Math.abs(selectedProbability - maximumProbability) > Number.EPSILON) {
    throw new Error("Choice 选择不是最高概率选项");
  }

  return {
    selectedId: answer.choice as TId,
    confidence: answer.confidence,
    probabilities: expectedIds.map((id) => ({ id, probability: answer.probabilities[id] })),
  };
}

/**
 * TypeSafe 的原始 Score 是连续位置。公开五级量表必须离散化：
 * 先取最高概率等级；并列时取最接近 raw score 的等级；仍并列时取较小等级。
 */
export function discretizeTypeSafeScore(
  rawScore: number,
  probabilities: Readonly<Record<string, number>>,
): DimensionScore {
  const scores = [0, 1, 2, 3, 4] as const;
  const maximumProbability = Math.max(...scores.map((score) => probabilities[String(score)]));
  return scores
    .filter((score) => Math.abs(probabilities[String(score)] - maximumProbability) <= Number.EPSILON)
    .sort((left, right) => {
      const distanceDifference = Math.abs(left - rawScore) - Math.abs(right - rawScore);
      return distanceDifference === 0 ? left - right : distanceDifference;
    })[0];
}

export function parseScoreAnswer(input: unknown): {
  score: DimensionScore;
  confidence: number;
  probabilities: Array<{ score: DimensionScore; probability: number }>;
} {
  const answer = TypeSafeScoreAnswerSchema.parse(input);
  const expectedKeys = ["0", "1", "2", "3", "4"];
  const probabilityKeys = Object.keys(answer.probabilities);
  const legendKeys = Object.keys(answer.legend);
  if (
    probabilityKeys.length !== expectedKeys.length ||
    legendKeys.length !== expectedKeys.length ||
    expectedKeys.some(
      (key) =>
        !Object.hasOwn(answer.probabilities, key) || !Object.hasOwn(answer.legend, key),
    )
  ) {
    throw new Error("Score 等级集合不完整");
  }
  assertProbabilityDistribution(answer.probabilities);
  const score = discretizeTypeSafeScore(answer.score, answer.probabilities);
  return {
    score,
    confidence: answer.confidence,
    probabilities: expectedKeys.map((key) => ({
      score: Number(key) as DimensionScore,
      probability: answer.probabilities[key],
    })),
  };
}

export type ParsedBroadChoice = ReturnType<
  typeof parseChoiceAnswer<RelationshipBroadId>
>;
export type ParsedSubtypeChoice = ReturnType<
  typeof parseChoiceAnswer<RelationshipSubtypeId>
>;

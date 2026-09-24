import "server-only";

import { randomUUID } from "node:crypto";

import {
  SignalAnalysisRequestSchema,
  SignalAnalysisResponseSchema,
  type BroadChoiceResult,
  type SignalAnalysisRequest,
  type SignalAnalysisResponse,
  type SubtypeResult,
} from "@/lib/contracts/analysis";
import {
  ANALYSIS_CONTEXT_TTL_SECONDS,
  ANALYSIS_CONTEXT_VERSION,
  ANALYSIS_RULESET_VERSION,
  EXPLANATION_POLICY_VERSION,
  SIGNALS_DEADLINE_MS,
  SUBTYPE_CONFIDENCE_THRESHOLD,
  SUBTYPE_PROBABILITY_MARGIN_THRESHOLD,
  TYPESAFE_SUBTYPE_ATTEMPT_TIMEOUT_MS,
  getBroadLabel,
  getChoiceDisplaySemantics,
  getSubtypeOptions,
} from "./ruleset";
import { computeDeterministicMetrics } from "./deterministic-metrics";
import {
  applyDimensionConfidence,
  computeInteractionBalance,
  computeInteractionIndex,
} from "./scoring";
import { validateAnalysisInputLimits } from "./input-validation";
import { mapAnalysisServiceError } from "./service-error";
import { createMessageDigest } from "@/server/security/message-digest";
import { signAnalysisContext } from "@/server/security/analysis-context";
import {
  HttpTypeSafeClient,
  type TypeSafeClient,
  type TypeSafePrimaryResult,
} from "@/server/typesafe/client";
import { UpstreamError } from "@/server/upstream-error";

export interface AnalyzeSignalsDependencies {
  typesafeClient?: TypeSafeClient;
  nowMs?: () => number;
  requestId?: () => string;
  contextSecret?: string;
}

function adaptBroadChoice(result: TypeSafePrimaryResult["broad"]): BroadChoiceResult {
  const selectedLabel = getBroadLabel(result.selectedId);
  return {
    selectedId: result.selectedId,
    selectedLabel,
    ...getChoiceDisplaySemantics(selectedLabel, result.confidence),
    probabilities: result.probabilities.map(({ id, probability }) => ({
      id,
      label: getBroadLabel(id),
      probability,
    })),
    confidence: result.confidence,
  };
}

function determineSubtypeSkip(broad: BroadChoiceResult): SubtypeResult | null {
  if (broad.selectedId === "unclear" || broad.selectedId === "other") {
    return { status: "skipped", reason: "broad_unclear_or_other" };
  }
  if (broad.confidence < SUBTYPE_CONFIDENCE_THRESHOLD) {
    return { status: "skipped", reason: "low_confidence" };
  }
  const sortedProbabilities = [...broad.probabilities].sort(
    (left, right) => right.probability - left.probability,
  );
  if (
    sortedProbabilities[0].probability - sortedProbabilities[1].probability <
    SUBTYPE_PROBABILITY_MARGIN_THRESHOLD
  ) {
    return { status: "skipped", reason: "small_probability_margin" };
  }
  return null;
}

export async function analyzeSignals(
  input: unknown,
  dependencies: AnalyzeSignalsDependencies = {},
): Promise<SignalAnalysisResponse> {
  try {
    const request: SignalAnalysisRequest = SignalAnalysisRequestSchema.parse(input);
    validateAnalysisInputLimits(request.messages);

    const nowMs = dependencies.nowMs ?? Date.now;
    const startedAt = nowMs();
    const deadlineController = new AbortController();
    const deadlineTimer = setTimeout(
      () => deadlineController.abort(new DOMException("Deadline", "AbortError")),
      SIGNALS_DEADLINE_MS,
    );
    try {
      const typesafeClient = dependencies.typesafeClient ?? new HttpTypeSafeClient();
      const primary = await typesafeClient.analyzePrimary(request.messages, {
        signal: deadlineController.signal,
      });
      const broad = adaptBroadChoice(primary.broad);
      const dimensions = primary.dimensions.map(applyDimensionConfidence);
      const derivedSignals = {
        interactionBalance: computeInteractionBalance(dimensions),
      };
      const interactionIndex = computeInteractionIndex(dimensions);

      const skippedSubtype = determineSubtypeSkip(broad);
      let subtype: SubtypeResult;
      if (skippedSubtype) {
        subtype = skippedSubtype;
      } else {
        const remainingMs = SIGNALS_DEADLINE_MS - (nowMs() - startedAt);
        if (remainingMs < TYPESAFE_SUBTYPE_ATTEMPT_TIMEOUT_MS) {
          subtype = { status: "temporarily_unavailable" };
        } else {
          try {
            const broadId = broad.selectedId as Exclude<typeof broad.selectedId, "other" | "unclear">;
            const subtypeResponse = await typesafeClient.analyzeSubtype(
              request.messages,
              broadId,
              { signal: deadlineController.signal },
            );
            const options = getSubtypeOptions(broadId);
            const selectedLabel = options.find(
              (option) => option.id === subtypeResponse.subtype.selectedId,
            )!.label;
            subtype = {
              status: "available",
              result: {
                selectedId: subtypeResponse.subtype.selectedId,
                selectedLabel,
                ...getChoiceDisplaySemantics(
                  selectedLabel,
                  subtypeResponse.subtype.confidence,
                ),
                probabilities: subtypeResponse.subtype.probabilities.map(
                  ({ id, probability }) => ({
                    id,
                    label: options.find((option) => option.id === id)!.label,
                    probability,
                  }),
                ),
                confidence: subtypeResponse.subtype.confidence,
              },
            };
          } catch (error) {
            // 细分是可降级能力，失败和超时都不能覆盖已经完成的主结果。
            if (error instanceof UpstreamError) {
              subtype = { status: "temporarily_unavailable" };
            } else {
              throw error;
            }
          }
        }
      }

      const relationshipClassification = { broad, subtype, notGroundTruth: true as const };
      const deterministicMetrics = computeDeterministicMetrics(request.messages);
      const issuedAt = Math.floor(nowMs() / 1000);
      const expiresAt = issuedAt + ANALYSIS_CONTEXT_TTL_SECONDS;
      const payload = {
        version: ANALYSIS_CONTEXT_VERSION,
        issuedAt,
        expiresAt,
        participants: request.participants,
        messageDigest: createMessageDigest(request.participants, request.messages),
        deterministicMetrics,
        relationshipClassification,
        dimensions,
        derivedSignals,
        interactionIndex,
        modelVersions: { typesafe: primary.model },
        analysisRulesetVersion: ANALYSIS_RULESET_VERSION,
        explanationPolicyVersion: EXPLANATION_POLICY_VERSION,
      };
      const analysisContext = signAnalysisContext(payload, dependencies.contextSecret);
      return SignalAnalysisResponseSchema.parse({
        relationshipClassification,
        dimensions,
        derivedSignals,
        interactionIndex,
        analysisContext,
        meta: {
          requestId: (dependencies.requestId ?? randomUUID)(),
          messageCount: deterministicMetrics.messageCount,
          modelVersions: { typesafe: primary.model },
          analysisRulesetVersion: ANALYSIS_RULESET_VERSION,
          explanationPolicyVersion: EXPLANATION_POLICY_VERSION,
          analysisContextExpiresAt: expiresAt,
        },
      });
    } finally {
      clearTimeout(deadlineTimer);
    }
  } catch (error) {
    throw mapAnalysisServiceError(error);
  }
}

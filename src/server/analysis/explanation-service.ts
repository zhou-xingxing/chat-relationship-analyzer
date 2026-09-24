import "server-only";

import { randomUUID } from "node:crypto";

import {
  ExplanationRequestSchema,
  ExplanationResponseSchema,
  type ExplanationRequest,
  type ExplanationResponse,
} from "@/lib/contracts/analysis";
import {
  ANALYSIS_RULESET_VERSION,
  EVIDENCE_EXCERPT_MAX_CODE_POINTS,
  EXPLANATION_DEADLINE_MS,
  EXPLANATION_POLICY_VERSION,
} from "./ruleset";
import { validateAnalysisInputLimits } from "./input-validation";
import { mapAnalysisServiceError } from "./service-error";
import { verifyAnalysisContext } from "@/server/security/analysis-context";
import { DeepSeekLlmClient, type LlmClient } from "@/server/llm/client";

export interface GenerateExplanationDependencies {
  llmClient?: LlmClient;
  nowMs?: () => number;
  requestId?: () => string;
  contextSecret?: string;
}

export function createEvidenceExcerpt(text: string): {
  excerpt: string;
  truncated: boolean;
} {
  const codePoints = Array.from(text);
  if (codePoints.length <= EVIDENCE_EXCERPT_MAX_CODE_POINTS) {
    return { excerpt: text, truncated: false };
  }
  return {
    excerpt: codePoints.slice(0, EVIDENCE_EXCERPT_MAX_CODE_POINTS).join(""),
    truncated: true,
  };
}

export async function generateExplanation(
  input: unknown,
  dependencies: GenerateExplanationDependencies = {},
): Promise<ExplanationResponse> {
  try {
    const request: ExplanationRequest = ExplanationRequestSchema.parse(input);
    validateAnalysisInputLimits(request.messages);
    const nowMs = dependencies.nowMs ?? Date.now;
    const context = verifyAnalysisContext({
      token: request.analysisContext,
      participants: request.participants,
      messages: request.messages,
      nowSeconds: Math.floor(nowMs() / 1000),
      secret: dependencies.contextSecret,
    });

    const deadlineController = new AbortController();
    const deadlineTimer = setTimeout(
      () => deadlineController.abort(new DOMException("Deadline", "AbortError")),
      EXPLANATION_DEADLINE_MS,
    );
    try {
      const llmClient = dependencies.llmClient ?? new DeepSeekLlmClient();
      const modelOutput = await llmClient.generateExplanation(request.messages, context, {
        signal: deadlineController.signal,
      });
      const messagesById = new Map(request.messages.map((message) => [message.id, message]));
      const dimensionInterpretations = modelOutput.dimensionInterpretations.map(
        (interpretation) => ({
          dimensionId: interpretation.dimensionId,
          evidence: interpretation.messageIds.map((messageId) => {
            const message = messagesById.get(messageId)!;
            return { messageId, ...createEvidenceExcerpt(message.text) };
          }),
          explanation: interpretation.explanation,
        }),
      );

      return ExplanationResponseSchema.parse({
        relationshipExplanation: {
          headline: modelOutput.headline,
          overview: modelOutput.overview,
          classificationExplanation: modelOutput.classificationExplanation,
          confidenceExplanation: modelOutput.confidenceExplanation,
          dimensionInterpretations,
          uncertainties: modelOutput.uncertainties,
          caveats: modelOutput.caveats,
        },
        meta: {
          requestId: (dependencies.requestId ?? randomUUID)(),
          messageCount: request.messages.length,
          modelVersions: { llm: llmClient.model },
          analysisRulesetVersion: ANALYSIS_RULESET_VERSION,
          explanationPolicyVersion: EXPLANATION_POLICY_VERSION,
        },
      });
    } finally {
      clearTimeout(deadlineTimer);
    }
  } catch (error) {
    throw mapAnalysisServiceError(error);
  }
}

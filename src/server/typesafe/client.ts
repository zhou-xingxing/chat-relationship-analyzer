import "server-only";

import { ZodError } from "zod";

import type { ChatMessage } from "@/lib/contracts/chat";
import type {
  RelationshipBroadId,
  RelationshipSubtypeId,
} from "@/lib/contracts/analysis";
import type { TrustedDimensionAssessment } from "@/server/analysis/scoring";
import {
  BROAD_OPTIONS,
  DIMENSION_DEFINITIONS,
  TYPESAFE_PRIMARY_ATTEMPT_TIMEOUT_MS,
  TYPESAFE_SUBTYPE_ATTEMPT_TIMEOUT_MS,
  getSubtypeOptions,
} from "@/server/analysis/ruleset";
import { UpstreamError, isAbortError } from "@/server/upstream-error";
import { buildPrimaryQuestions, buildSubtypeQuestions, buildTypeSafeState } from "./questions";
import {
  TypeSafeResponseEnvelopeSchema,
  parseChoiceAnswer,
  parseScoreAnswer,
} from "./schemas";

const TYPESAFE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

export interface TypeSafePrimaryResult {
  model: string;
  broad: ReturnType<typeof parseChoiceAnswer<RelationshipBroadId>>;
  dimensions: TrustedDimensionAssessment[];
}

export interface TypeSafeSubtypeResult {
  model: string;
  subtype: {
    selectedId: RelationshipSubtypeId;
    confidence: number;
    probabilities: Array<{ id: RelationshipSubtypeId; probability: number }>;
  };
}

export interface TypeSafeClient {
  analyzePrimary(messages: readonly ChatMessage[], options?: { signal?: AbortSignal }): Promise<TypeSafePrimaryResult>;
  analyzeSubtype(
    messages: readonly ChatMessage[],
    broadId: Exclude<RelationshipBroadId, "other" | "unclear">,
    options?: { signal?: AbortSignal },
  ): Promise<TypeSafeSubtypeResult>;
}

interface TypeSafeClientOptions {
  apiKey?: string;
  model?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

function timeoutSignal(parent: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) {
    controller.abort(parent.reason);
  } else {
    parent?.addEventListener("abort", onParentAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new DOMException("Timeout", "AbortError")), timeoutMs);
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
    },
  };
}

export class HttpTypeSafeClient implements TypeSafeClient {
  private readonly fetchImpl: typeof fetch;
  private readonly endpoint: string;
  private readonly apiKey: string;
  readonly model: string;

  constructor(options: TypeSafeClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY ?? "";
    this.model = options.model ?? process.env.TYPESAFE_MODEL ?? "jev-1.13.0";
    this.endpoint = options.endpoint ?? TYPESAFE_ENDPOINT;
    this.fetchImpl = options.fetchImpl ?? fetch;
    if (!this.apiKey) {
      throw new Error("TYPESAFE_API_KEY 未配置");
    }
  }

  private async request(
    messages: readonly ChatMessage[],
    questions: Record<string, unknown>,
    timeoutMs: number,
    parentSignal?: AbortSignal,
  ): Promise<string> {
    const { signal, dispose } = timeoutSignal(parentSignal, timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ state: buildTypeSafeState(messages), model: this.model, questions }),
        signal,
      });
      if (!response.ok) {
        throw new UpstreamError("typesafe", "request_failed");
      }
      return await response.text();
    } catch (error) {
      if (error instanceof UpstreamError) throw error;
      if (isAbortError(error) || signal.aborted) {
        throw new UpstreamError("typesafe", "timeout");
      }
      throw new UpstreamError("typesafe", "request_failed");
    } finally {
      dispose();
    }
  }

  private async requestWithInvalidResponseRetry<T>(
    messages: readonly ChatMessage[],
    questions: Record<string, unknown>,
    timeoutMs: number,
    parse: (input: unknown) => T,
    parentSignal?: AbortSignal,
  ): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const raw = await this.request(messages, questions, timeoutMs, parentSignal);
      try {
        return parse(JSON.parse(raw) as unknown);
      } catch (error) {
        if (!(error instanceof ZodError) && !(error instanceof Error)) throw error;
        if (attempt === 1) throw new UpstreamError("typesafe", "invalid_response");
        // TypeSafe 原生保证结构化输出；重试只用于收到但无法通过本地完整性校验的响应。
      }
    }
    throw new UpstreamError("typesafe", "invalid_response");
  }

  async analyzePrimary(
    messages: readonly ChatMessage[],
    options: { signal?: AbortSignal } = {},
  ): Promise<TypeSafePrimaryResult> {
    return this.requestWithInvalidResponseRetry(
      messages,
      buildPrimaryQuestions(),
      TYPESAFE_PRIMARY_ATTEMPT_TIMEOUT_MS,
      (input) => {
        const response = TypeSafeResponseEnvelopeSchema.parse(input);
        const expectedAnswerIds = [
          "relationship_broad",
          ...DIMENSION_DEFINITIONS.map((dimension) => dimension.id),
        ];
        if (
          Object.keys(response.answers).length !== expectedAnswerIds.length ||
          expectedAnswerIds.some((id) => !Object.hasOwn(response.answers, id))
        ) {
          throw new Error("主分析答案集合不完整");
        }
        return {
          model: response.model,
          broad: parseChoiceAnswer(
            response.answers.relationship_broad,
            BROAD_OPTIONS.map((option) => option.id),
          ),
          dimensions: DIMENSION_DEFINITIONS.map((dimension) => ({
            dimensionId: dimension.id,
            ...parseScoreAnswer(response.answers[dimension.id]),
          })),
        };
      },
      options.signal,
    );
  }

  async analyzeSubtype(
    messages: readonly ChatMessage[],
    broadId: Exclude<RelationshipBroadId, "other" | "unclear">,
    options: { signal?: AbortSignal } = {},
  ): Promise<TypeSafeSubtypeResult> {
    const subtypeOptions = getSubtypeOptions(broadId);
    return this.requestWithInvalidResponseRetry(
      messages,
      buildSubtypeQuestions(broadId),
      TYPESAFE_SUBTYPE_ATTEMPT_TIMEOUT_MS,
      (input) => {
        const response = TypeSafeResponseEnvelopeSchema.parse(input);
        if (
          Object.keys(response.answers).length !== 1 ||
          !Object.hasOwn(response.answers, "relationship_subtype")
        ) {
          throw new Error("细分答案集合不完整");
        }
        return {
          model: response.model,
          subtype: parseChoiceAnswer(
            response.answers.relationship_subtype,
            subtypeOptions.map((option) => option.id),
          ),
        };
      },
      options.signal,
    );
  }
}

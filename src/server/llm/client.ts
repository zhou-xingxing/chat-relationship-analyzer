import "server-only";

import OpenAI from "openai";

import type { AnalysisContextPayload } from "@/lib/contracts/analysis";
import type { ChatMessage } from "@/lib/contracts/chat";
import {
  LLM_INITIAL_TIMEOUT_MS,
  LLM_MAX_OUTPUT_TOKENS,
  LLM_REPAIR_TIMEOUT_MS,
} from "@/server/analysis/ruleset";
import { UpstreamError, isAbortError } from "@/server/upstream-error";
import { buildExplanationUserPrompt, buildRepairPrompt, EXPLANATION_SYSTEM_PROMPT } from "./prompt";
import {
  parseAndValidateExplanationOutput,
  type RelationshipExplanationModelOutput,
} from "./schemas";

type PromptMessage = { role: "system" | "user" | "assistant"; content: string };
type CompletionFunction = (
  messages: readonly PromptMessage[],
  signal: AbortSignal,
) => Promise<string>;

export interface LlmClient {
  readonly model: string;
  generateExplanation(
    messages: readonly ChatMessage[],
    context: AnalysisContextPayload,
    options?: { signal?: AbortSignal },
  ): Promise<RelationshipExplanationModelOutput>;
}

interface DeepSeekLlmClientOptions {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  complete?: CompletionFunction;
}

function createTimedSignal(parent: AbortSignal | undefined, timeoutMs: number) {
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
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
    },
  };
}

function parseJsonObject(content: string): unknown {
  return JSON.parse(content) as unknown;
}

export class DeepSeekLlmClient implements LlmClient {
  readonly model: string;
  private readonly complete: CompletionFunction;

  constructor(options: DeepSeekLlmClientOptions = {}) {
    this.model = options.model ?? process.env.LLM_MODEL ?? "deepseek-flash";
    if (options.complete) {
      this.complete = options.complete;
      return;
    }

    const apiKey = options.apiKey ?? process.env.LLM_API_KEY;
    if (!apiKey) throw new Error("LLM_API_KEY 未配置");
    const client = new OpenAI({
      apiKey,
      baseURL: options.baseURL ?? process.env.LLM_BASE_URL ?? "https://api.deepseek.com",
      maxRetries: 0,
    });
    this.complete = async (messages, signal) => {
      const request = {
        model: this.model,
        messages: messages.map((message) => ({ ...message })),
        response_format: { type: "json_object" } as const,
        temperature: 0.2,
        max_tokens: LLM_MAX_OUTPUT_TOKENS,
        thinking: { type: "disabled" } as const,
      };
      const completion = await client.chat.completions.create(request, { signal });
      const content = completion.choices[0]?.message.content;
      return content ?? "";
    };
  }

  private async invoke(
    promptMessages: readonly PromptMessage[],
    timeoutMs: number,
    parentSignal?: AbortSignal,
  ): Promise<string> {
    const timed = createTimedSignal(parentSignal, timeoutMs);
    try {
      return await this.complete(promptMessages, timed.signal);
    } catch (error) {
      if (isAbortError(error) || timed.signal.aborted) {
        throw new UpstreamError("llm", "timeout");
      }
      throw new UpstreamError("llm", "request_failed");
    } finally {
      timed.dispose();
    }
  }

  async generateExplanation(
    messages: readonly ChatMessage[],
    context: AnalysisContextPayload,
    options: { signal?: AbortSignal } = {},
  ): Promise<RelationshipExplanationModelOutput> {
    const promptMessages: PromptMessage[] = [
      { role: "system", content: EXPLANATION_SYSTEM_PROMPT },
      { role: "user", content: buildExplanationUserPrompt(messages, context) },
    ];
    const firstOutput = await this.invoke(promptMessages, LLM_INITIAL_TIMEOUT_MS, options.signal);
    try {
      return parseAndValidateExplanationOutput(parseJsonObject(firstOutput), messages);
    } catch {
      const repairedOutput = await this.invoke(
        [
          ...promptMessages,
          { role: "assistant", content: firstOutput },
          { role: "user", content: buildRepairPrompt() },
        ],
        LLM_REPAIR_TIMEOUT_MS,
        options.signal,
      );
      try {
        return parseAndValidateExplanationOutput(parseJsonObject(repairedOutput), messages);
      } catch {
        throw new UpstreamError("llm", "invalid_response");
      }
    }
  }
}

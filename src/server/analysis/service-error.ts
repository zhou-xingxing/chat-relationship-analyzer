import "server-only";

import { ZodError } from "zod";

import type { ApiErrorCode } from "@/lib/contracts/errors";
import { AnalysisContextUnavailableError } from "@/server/security/analysis-context";
import { UpstreamError } from "@/server/upstream-error";

const PUBLIC_MESSAGES: Record<ApiErrorCode, string> = {
  INVALID_REQUEST: "请求内容不符合要求，请检查后重试。",
  SAMPLE_TOO_SMALL: "聊天样本不足，请提供至少 8 条消息，且双方各至少 2 条。",
  PAYLOAD_TOO_LARGE: "聊天内容超出分析限制，请缩小聊天范围后重试。",
  ANALYSIS_CONTEXT_UNAVAILABLE: "当前分析上下文已失效，请重新运行完整分析。",
  UPSTREAM_INVALID_RESPONSE: "分析服务暂时无法生成有效结果，请稍后重试。",
  UPSTREAM_TIMEOUT: "分析服务响应超时，请稍后重试。",
  INTERNAL_ERROR: "服务暂时不可用，请稍后重试。",
};

export class AnalysisServiceError extends Error {
  readonly name = "AnalysisServiceError";
  readonly publicMessage: string;

  constructor(
    readonly code: ApiErrorCode,
    readonly status: 400 | 413 | 422 | 500 | 502 | 504,
    readonly internalReason?: string,
  ) {
    super(PUBLIC_MESSAGES[code]);
    this.publicMessage = PUBLIC_MESSAGES[code];
  }
}

export function mapAnalysisServiceError(error: unknown): AnalysisServiceError {
  if (error instanceof AnalysisServiceError) return error;
  if (error instanceof AnalysisContextUnavailableError) {
    return new AnalysisServiceError(
      "ANALYSIS_CONTEXT_UNAVAILABLE",
      400,
      `context_${error.reason}`,
    );
  }
  if (error instanceof ZodError) {
    return new AnalysisServiceError("INVALID_REQUEST", 400, "schema_validation_failed");
  }
  if (error instanceof UpstreamError) {
    if (error.kind === "timeout") {
      return new AnalysisServiceError("UPSTREAM_TIMEOUT", 504, `${error.source}_timeout`);
    }
    return new AnalysisServiceError(
      "UPSTREAM_INVALID_RESPONSE",
      502,
      `${error.source}_${error.kind}`,
    );
  }
  return new AnalysisServiceError("INTERNAL_ERROR", 500, "unexpected_internal_error");
}

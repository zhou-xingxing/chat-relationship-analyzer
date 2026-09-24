import "server-only";

import { randomUUID } from "node:crypto";

import type { ApiErrorCode } from "@/lib/contracts/errors";
import {
  AnalysisServiceError,
  mapAnalysisServiceError,
} from "@/server/analysis/service-error";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

export interface ApiRequestContext {
  requestId: string;
  startedAt: number;
}

export function createApiRequestContext(): ApiRequestContext {
  return { requestId: randomUUID(), startedAt: Date.now() };
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AnalysisServiceError("INVALID_REQUEST", 400, "invalid_json");
  }
}

export function successResponse(payload: unknown): Response {
  return Response.json(payload, { status: 200, headers: NO_STORE_HEADERS });
}

export function errorResponse(error: unknown, context: ApiRequestContext): Response {
  const mapped = mapAnalysisServiceError(error);
  logRequest(context, mapped.status, mapped.code, mapped.internalReason);
  return Response.json(
    {
      error: {
        code: mapped.code,
        message: mapped.publicMessage,
        requestId: context.requestId,
      },
    },
    { status: mapped.status, headers: NO_STORE_HEADERS },
  );
}

export function logRequest(
  context: ApiRequestContext,
  status: number,
  code: ApiErrorCode | "OK",
  internalReason?: string,
): void {
  // 仅记录诊断元数据；禁止把请求体、昵称、正文、模型响应或原始异常传入这里。
  console.info(
    JSON.stringify({
      event: "analysis_request",
      requestId: context.requestId,
      durationMs: Date.now() - context.startedAt,
      status,
      code,
      ...(internalReason ? { internalReason } : {}),
    }),
  );
}

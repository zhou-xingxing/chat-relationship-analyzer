import "server-only";

export type UpstreamErrorKind = "timeout" | "invalid_response" | "request_failed";

export class UpstreamError extends Error {
  readonly name = "UpstreamError";

  constructor(
    readonly source: "typesafe" | "llm",
    readonly kind: UpstreamErrorKind,
  ) {
    super(`${source} 上游调用失败`);
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

import { z } from "zod";

export const API_ERROR_CODES = [
  "INVALID_REQUEST",
  "SAMPLE_TOO_SMALL",
  "PAYLOAD_TOO_LARGE",
  "ANALYSIS_CONTEXT_UNAVAILABLE",
  "UPSTREAM_INVALID_RESPONSE",
  "UPSTREAM_TIMEOUT",
  "INTERNAL_ERROR",
] as const;

export const ApiErrorCodeSchema = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: ApiErrorCodeSchema,
    message: z.string().min(1),
    requestId: z.string().min(1),
  }),
});
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

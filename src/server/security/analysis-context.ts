import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { AnalysisContextPayloadSchema } from "@/lib/contracts/analysis";
import type { AnalysisContextPayload } from "@/lib/contracts/analysis";
import type { ChatMessage, Participants } from "@/lib/contracts/chat";
import {
  ANALYSIS_CONTEXT_VERSION,
  ANALYSIS_RULESET_VERSION,
  EXPLANATION_POLICY_VERSION,
  MAX_ANALYSIS_CONTEXT_TOKEN_LENGTH,
} from "@/server/analysis/ruleset";
import { createMessageDigest } from "./message-digest";

export type AnalysisContextFailureReason =
  | "malformed"
  | "signature_mismatch"
  | "expired"
  | "unsupported_context_version"
  | "unsupported_analysis_ruleset"
  | "unsupported_explanation_policy"
  | "participants_mismatch"
  | "message_digest_mismatch";

export class AnalysisContextUnavailableError extends Error {
  readonly name = "AnalysisContextUnavailableError";

  constructor(readonly reason: AnalysisContextFailureReason) {
    super("分析上下文不可用");
  }
}

function getContextSecret(secret?: string): string {
  const resolved = secret ?? process.env.ANALYSIS_CONTEXT_SECRET;
  if (!resolved) {
    throw new Error("ANALYSIS_CONTEXT_SECRET 未配置");
  }
  return resolved;
}

function signEncodedPayload(encodedPayload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(encodedPayload, "utf8").digest();
}

export function signAnalysisContext(
  payload: AnalysisContextPayload,
  secret?: string,
): string {
  const validatedPayload = AnalysisContextPayloadSchema.parse(payload);
  const encodedPayload = Buffer.from(JSON.stringify(validatedPayload), "utf8").toString("base64url");
  const signature = signEncodedPayload(encodedPayload, getContextSecret(secret)).toString("base64url");
  return `${encodedPayload}.${signature}`;
}

function parseAndVerifyToken(token: string, secret?: string): AnalysisContextPayload {
  if (
    token.length === 0 ||
    token.length > MAX_ANALYSIS_CONTEXT_TOKEN_LENGTH ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
  ) {
    throw new AnalysisContextUnavailableError("malformed");
  }

  const [encodedPayload, encodedSignature] = token.split(".");
  let receivedSignature: Buffer;
  try {
    receivedSignature = Buffer.from(encodedSignature, "base64url");
  } catch {
    throw new AnalysisContextUnavailableError("malformed");
  }

  const expectedSignature = signEncodedPayload(encodedPayload, getContextSecret(secret));
  if (
    receivedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(receivedSignature, expectedSignature)
  ) {
    throw new AnalysisContextUnavailableError("signature_mismatch");
  }

  try {
    const parsed: unknown = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      parsed.version !== ANALYSIS_CONTEXT_VERSION
    ) {
      throw new AnalysisContextUnavailableError("unsupported_context_version");
    }
    return AnalysisContextPayloadSchema.parse(parsed);
  } catch (error) {
    if (error instanceof AnalysisContextUnavailableError) throw error;
    throw new AnalysisContextUnavailableError("malformed");
  }
}

export interface VerifyAnalysisContextInput {
  token: string;
  participants: Participants;
  messages: readonly ChatMessage[];
  nowSeconds?: number;
  secret?: string;
}

export function verifyAnalysisContext({
  token,
  participants,
  messages,
  nowSeconds = Math.floor(Date.now() / 1000),
  secret,
}: VerifyAnalysisContextInput): AnalysisContextPayload {
  const payload = parseAndVerifyToken(token, secret);

  if (payload.version !== ANALYSIS_CONTEXT_VERSION) {
    throw new AnalysisContextUnavailableError("unsupported_context_version");
  }
  if (payload.expiresAt <= nowSeconds) {
    throw new AnalysisContextUnavailableError("expired");
  }
  if (payload.analysisRulesetVersion !== ANALYSIS_RULESET_VERSION) {
    throw new AnalysisContextUnavailableError("unsupported_analysis_ruleset");
  }
  if (payload.explanationPolicyVersion !== EXPLANATION_POLICY_VERSION) {
    throw new AnalysisContextUnavailableError("unsupported_explanation_policy");
  }
  if (
    payload.participants.meId !== participants.meId ||
    payload.participants.otherId !== participants.otherId
  ) {
    throw new AnalysisContextUnavailableError("participants_mismatch");
  }

  const expectedDigest = createMessageDigest(participants, messages);
  const actualDigest = Buffer.from(payload.messageDigest, "utf8");
  const expectedDigestBuffer = Buffer.from(expectedDigest, "utf8");
  if (
    actualDigest.length !== expectedDigestBuffer.length ||
    !timingSafeEqual(actualDigest, expectedDigestBuffer)
  ) {
    throw new AnalysisContextUnavailableError("message_digest_mismatch");
  }

  return payload;
}

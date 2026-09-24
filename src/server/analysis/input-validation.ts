import "server-only";

import type { ChatMessage } from "@/lib/contracts/chat";
import {
  MAX_MESSAGE_COUNT,
  MAX_NORMALIZED_CHARACTER_COUNT,
  MIN_MESSAGE_COUNT,
  MIN_MESSAGES_PER_PARTICIPANT,
} from "@/lib/config/input-limits";
import { AnalysisServiceError } from "./service-error";
import { countUnicodeCodePoints } from "./deterministic-metrics";

export function validateAnalysisInputLimits(messages: readonly ChatMessage[]): void {
  if (messages.length > MAX_MESSAGE_COUNT) {
    throw new AnalysisServiceError("PAYLOAD_TOO_LARGE", 413, "message_count_exceeded");
  }
  let characterCount = 0;
  const participantCounts = { a: 0, b: 0 };
  for (const message of messages) {
    characterCount += countUnicodeCodePoints(message.text);
    participantCounts[message.senderId] += 1;
  }
  if (characterCount > MAX_NORMALIZED_CHARACTER_COUNT) {
    throw new AnalysisServiceError("PAYLOAD_TOO_LARGE", 413, "character_count_exceeded");
  }
  if (
    messages.length < MIN_MESSAGE_COUNT ||
    participantCounts.a < MIN_MESSAGES_PER_PARTICIPANT ||
    participantCounts.b < MIN_MESSAGES_PER_PARTICIPANT
  ) {
    throw new AnalysisServiceError("SAMPLE_TOO_SMALL", 422, "sample_threshold_not_met");
  }
}

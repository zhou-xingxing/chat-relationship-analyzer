import "server-only";

import type { ChatMessage, ParticipantId } from "@/lib/contracts/chat";
import type { DeterministicMetrics } from "@/lib/contracts/analysis";

export function countUnicodeCodePoints(value: string): number {
  return Array.from(value).length;
}

export function computeDeterministicMetrics(
  messages: readonly ChatMessage[],
): DeterministicMetrics {
  const participantMessageCounts: Record<ParticipantId, number> = { a: 0, b: 0 };
  let normalizedCharacterCount = 0;

  for (const message of messages) {
    participantMessageCounts[message.senderId] += 1;
    normalizedCharacterCount += countUnicodeCodePoints(message.text);
  }

  const messageCount = messages.length;
  return {
    messageCount,
    normalizedCharacterCount,
    participantMessageCounts,
    participantMessageShares: {
      a: messageCount === 0 ? 0 : participantMessageCounts.a / messageCount,
      b: messageCount === 0 ? 0 : participantMessageCounts.b / messageCount,
    },
  };
}

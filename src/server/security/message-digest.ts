import "server-only";

import { createHash } from "node:crypto";

import type { ChatMessage, Participants } from "@/lib/contracts/chat";

const MESSAGE_DIGEST_VERSION = 1 as const;

/**
 * 使用固定字段顺序序列化，避免对象属性插入顺序影响两次请求的摘要。
 */
export function serializeMessagesForDigest(
  participants: Participants,
  messages: readonly ChatMessage[],
): string {
  return JSON.stringify({
    version: MESSAGE_DIGEST_VERSION,
    meId: participants.meId,
    otherId: participants.otherId,
    messages: messages.map((message) => [
      message.id,
      message.senderId,
      message.timestamp,
      message.kind,
      message.text,
    ]),
  });
}

export function createMessageDigest(
  participants: Participants,
  messages: readonly ChatMessage[],
): string {
  return createHash("sha256")
    .update(serializeMessagesForDigest(participants, messages), "utf8")
    .digest("base64url");
}

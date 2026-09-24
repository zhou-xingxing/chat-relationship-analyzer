import type { ChatMessage, MessageKind, ParticipantId } from "@/lib/contracts/chat";
import { MEDIA_PLACEHOLDERS } from "@/lib/contracts/chat";
import {
  MAX_MESSAGE_COUNT,
  MAX_NORMALIZED_CHARACTER_COUNT,
  MIN_MESSAGE_COUNT,
  MIN_MESSAGES_PER_PARTICIPANT,
} from "@/lib/config/input-limits";
import {
  KNOWN_WECHAT_EMOJI_NAMES,
  SYSTEM_NOTIFICATION_PATTERNS,
} from "@/lib/config/wechat-markers";

const WECHAT_TIMESTAMP_PATTERN =
  /^(\d{4})年(\d{2})月(\d{2})日 +(\d|[01]\d|2[0-3]):([0-5]\d)$/;
const BRACKET_TOKEN_PATTERN = /^\[([^\[\]\r\n]+)\]$/u;

/** 只接受已经进入 MVP 验收范围的规范化媒体占位符。 */
const MEDIA_KIND_BY_PLACEHOLDER = new Map<string, Exclude<MessageKind, "text" | "emoji">>([
  [MEDIA_PLACEHOLDERS.image, "image"],
  [MEDIA_PLACEHOLDERS.sticker, "sticker"],
  ["[动画表情]", "sticker"],
  [MEDIA_PLACEHOLDERS.voice, "voice"],
  [MEDIA_PLACEHOLDERS.file, "file"],
]);

export interface ClassifiedMessageBody {
  kind: MessageKind;
  text: string;
}

export interface ChatLimitStats {
  messageCount: number;
  normalizedCharacterCount: number;
  participantMessageCounts: Record<ParticipantId, number>;
}

export type ChatLimitValidationResult =
  | { valid: true; stats: ChatLimitStats }
  | {
      valid: false;
      error: {
        code: "SAMPLE_TOO_SMALL" | "PAYLOAD_TOO_LARGE";
        message: string;
      };
      stats: ChatLimitStats;
    };

export function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

/** 只移除正文首尾的空白行，不改写正文内部的换行和空格。 */
export function trimOuterBlankLines(value: string): string {
  const lines = normalizeLineEndings(value).split("\n");
  let start = 0;
  let end = lines.length;

  while (start < end && lines[start]?.trim() === "") {
    start += 1;
  }
  while (end > start && lines[end - 1]?.trim() === "") {
    end -= 1;
  }

  return lines.slice(start, end).join("\n");
}

export function parseWechatTimestamp(value: string): string | null {
  const match = WECHAT_TIMESTAMP_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    return null;
  }

  return `${yearText}-${monthText}-${dayText}T${hourText.padStart(2, "0")}:${minuteText}:00+08:00`;
}

export function isSystemNotification(body: string): boolean {
  const normalized = trimOuterBlankLines(body).trim();
  return SYSTEM_NOTIFICATION_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function classifyMessageBody(body: string): ClassifiedMessageBody {
  const preservedText = trimOuterBlankLines(body);
  const marker = preservedText.trim();
  const mediaKind = MEDIA_KIND_BY_PLACEHOLDER.get(marker);
  if (mediaKind) {
    return { kind: mediaKind, text: MEDIA_PLACEHOLDERS[mediaKind] };
  }

  const bracketMatch = BRACKET_TOKEN_PATTERN.exec(marker);
  if (
    marker === "[表情]" ||
    (bracketMatch && KNOWN_WECHAT_EMOJI_NAMES.has(bracketMatch[1] ?? ""))
  ) {
    return { kind: "emoji", text: marker };
  }

  return { kind: "text", text: preservedText };
}

export function countUnicodeCodePoints(value: string): number {
  return [...value].length;
}

export function getChatLimitStats(messages: readonly ChatMessage[]): ChatLimitStats {
  const participantMessageCounts: Record<ParticipantId, number> = { a: 0, b: 0 };
  let normalizedCharacterCount = 0;

  for (const message of messages) {
    participantMessageCounts[message.senderId] += 1;
    normalizedCharacterCount += countUnicodeCodePoints(message.text);
  }

  return {
    messageCount: messages.length,
    normalizedCharacterCount,
    participantMessageCounts,
  };
}

export function validateChatLimits(
  messages: readonly ChatMessage[],
): ChatLimitValidationResult {
  const stats = getChatLimitStats(messages);

  if (
    stats.messageCount > MAX_MESSAGE_COUNT ||
    stats.normalizedCharacterCount > MAX_NORMALIZED_CHARACTER_COUNT
  ) {
    return {
      valid: false,
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "聊天内容超过分析上限，请选择更短的时间范围后重试。",
      },
      stats,
    };
  }

  if (
    stats.messageCount < MIN_MESSAGE_COUNT ||
    stats.participantMessageCounts.a < MIN_MESSAGES_PER_PARTICIPANT ||
    stats.participantMessageCounts.b < MIN_MESSAGES_PER_PARTICIPANT
  ) {
    return {
      valid: false,
      error: {
        code: "SAMPLE_TOO_SMALL",
        message: `至少需要 ${MIN_MESSAGE_COUNT} 条有效消息，且双方各至少 ${MIN_MESSAGES_PER_PARTICIPANT} 条。`,
      },
      stats,
    };
  }

  return { valid: true, stats };
}

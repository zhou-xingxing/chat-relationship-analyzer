import { z } from "zod";

import { KNOWN_WECHAT_EMOJI_NAMES } from "@/lib/config/wechat-markers";

export const PARTICIPANT_IDS = ["a", "b"] as const;
export const MESSAGE_KINDS = [
  "text",
  "emoji",
  "image",
  "sticker",
  "voice",
  "file",
] as const;
export const DIMENSION_SCORES = [0, 1, 2, 3, 4] as const;

export const MEDIA_PLACEHOLDERS = {
  image: "[图片]",
  sticker: "[贴纸]",
  voice: "[语音]",
  file: "[文件]",
} as const;

export const ParticipantIdSchema = z.enum(PARTICIPANT_IDS);
export type ParticipantId = z.infer<typeof ParticipantIdSchema>;

export const MessageKindSchema = z.enum(MESSAGE_KINDS);
export type MessageKind = z.infer<typeof MessageKindSchema>;

export const DimensionScoreSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
export type DimensionScore = z.infer<typeof DimensionScoreSchema>;

const CANONICAL_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):00\+08:00$/;
const BRACKET_EMOJI_PATTERN = /^\[[^\[\]\r\n]+\]$/u;

function isKnownEmojiMarker(value: string): boolean {
  if (value === "[表情]") {
    return true;
  }
  if (!BRACKET_EMOJI_PATTERN.test(value)) {
    return false;
  }
  return KNOWN_WECHAT_EMOJI_NAMES.has(value.slice(1, -1));
}

function isValidCanonicalTimestamp(value: string): boolean {
  const match = CANONICAL_TIMESTAMP_PATTERN.exec(value);
  if (!match) {
    return false;
  }

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59
  );
}

export const CanonicalChatTimestampSchema = z
  .string()
  .refine(isValidCanonicalTimestamp, {
    message: "时间戳必须是合法且带 +08:00 偏移的 ISO 8601 时间",
  });

export const ChatMessageSchema = z
  .strictObject({
    id: z.string().trim().min(1, "消息 ID 不能为空"),
    senderId: ParticipantIdSchema,
    timestamp: CanonicalChatTimestampSchema,
    kind: MessageKindSchema,
    text: z.string().min(1, "消息正文不能为空"),
  })
  .superRefine((message, context) => {
    const marker = message.text.trim();
    if (message.text.includes("\r")) {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "消息正文必须先将换行规范化为 LF",
      });
    }

    if (marker.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "消息正文不能只包含空白",
      });
      return;
    }

    if (message.kind === "emoji") {
      if (message.text !== marker || !isKnownEmojiMarker(marker)) {
        context.addIssue({
          code: "custom",
          path: ["text"],
          message: "表情消息正文必须是已知且唯一的方括号表情标记",
        });
      }
      return;
    }

    if (message.kind !== "text") {
      if (message.text !== MEDIA_PLACEHOLDERS[message.kind]) {
        context.addIssue({
          code: "custom",
          path: ["text"],
          message: "媒体消息正文必须使用对应的规范化占位符",
        });
      }
      return;
    }

    const isMediaPlaceholder = Object.values(MEDIA_PLACEHOLDERS).some(
      (placeholder) => marker === placeholder,
    );
    if (isMediaPlaceholder || isKnownEmojiMarker(marker)) {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "仅包含规范化占位符的消息必须使用对应的消息类型",
      });
    }
  });
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ParticipantsSchema = z
  .strictObject({
    meId: ParticipantIdSchema,
    otherId: ParticipantIdSchema,
  })
  .superRefine((participants, context) => {
    if (participants.meId === participants.otherId) {
      context.addIssue({
        code: "custom",
        path: ["otherId"],
        message: "我和对方必须是不同参与者",
      });
    }
  });
export type Participants = z.infer<typeof ParticipantsSchema>;

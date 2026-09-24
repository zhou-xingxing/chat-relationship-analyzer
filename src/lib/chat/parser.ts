import type { ChatMessage, ParticipantId } from "@/lib/contracts/chat";
import type { ChatLimitStats } from "@/lib/chat/normalize";
import {
  classifyMessageBody,
  isSystemNotification,
  normalizeLineEndings,
  parseWechatTimestamp,
  trimOuterBlankLines,
  validateChatLimits,
} from "@/lib/chat/normalize";

export interface ParsedParticipant {
  id: ParticipantId;
  displayName: string;
}

export interface ParsedWechatChat {
  participants: [ParsedParticipant, ParsedParticipant];
  messages: ChatMessage[];
}

export type WechatParseErrorCode =
  | "EMPTY_INPUT"
  | "UNSUPPORTED_FORMAT"
  | "INVALID_RECORD"
  | "INVALID_PARTICIPANT_COUNT"
  | "SAMPLE_TOO_SMALL"
  | "PAYLOAD_TOO_LARGE";

export interface WechatParseError {
  code: WechatParseErrorCode;
  message: string;
  /** 从 1 开始的记录序号，仅在错误能定位到单条记录时出现。 */
  recordIndex?: number;
}

export type ParseWechatChatResult =
  | { success: true; data: ParsedWechatChat; stats: ChatLimitStats }
  | { success: false; error: WechatParseError };

const WECHAT_TIMESTAMP_LIKE_PATTERN = /^\d{4}年\d{2}月\d{2}日 +\d{1,2}:\d{2}$/u;

/**
 * 只在空行后出现“发送者 + 微信时间行”时切分记录，正文内部的空白段原样保留。
 * 时间行即使日期值非法也先作为边界，随后由严格时间解析给出记录级错误。
 */
function splitWechatRecords(input: string): string[] {
  const lines = input.split("\n");
  const records: string[] = [];
  let recordStart = 0;
  let cursor = 2;

  while (cursor < lines.length) {
    if (lines[cursor]?.trim() !== "") {
      cursor += 1;
      continue;
    }

    let nextStart = cursor;
    while (nextStart < lines.length && lines[nextStart]?.trim() === "") {
      nextStart += 1;
    }

    const candidateSender = lines[nextStart]?.trim() ?? "";
    const candidateTimestamp = lines[nextStart + 1]?.trim() ?? "";
    if (candidateSender !== "" && WECHAT_TIMESTAMP_LIKE_PATTERN.test(candidateTimestamp)) {
      records.push(lines.slice(recordStart, cursor).join("\n"));
      recordStart = nextStart;
      cursor = nextStart + 2;
      continue;
    }

    cursor = nextStart + 1;
  }

  records.push(lines.slice(recordStart).join("\n"));
  return records;
}

function unsupportedRecord(recordIndex: number, detail: string): ParseWechatChatResult {
  return {
    success: false,
    error: {
      code: "INVALID_RECORD",
      message: `第 ${recordIndex} 条记录${detail}，暂不支持这种聊天复制格式。`,
      recordIndex,
    },
  };
}

/**
 * 解析唯一支持的微信桌面端复制结构。此函数只做确定性本地处理，绝不调用外部服务。
 */
export function parseWechatChat(input: string): ParseWechatChatResult {
  const normalizedInput = trimOuterBlankLines(normalizeLineEndings(input));
  if (normalizedInput.trim() === "") {
    return {
      success: false,
      error: { code: "EMPTY_INPUT", message: "请先粘贴微信聊天记录。" },
    };
  }

  const rawRecords = splitWechatRecords(normalizedInput);
  const senderIdByName = new Map<string, ParticipantId>();
  const participantNames: string[] = [];
  const messages: ChatMessage[] = [];

  for (const [recordOffset, rawRecord] of rawRecords.entries()) {
    const recordIndex = recordOffset + 1;
    const lines = rawRecord.split("\n");
    if (lines.length < 3) {
      return unsupportedRecord(recordIndex, "缺少发送者、时间或正文");
    }

    const senderName = lines[0]?.trim() ?? "";
    if (senderName === "") {
      return unsupportedRecord(recordIndex, "缺少发送者");
    }

    const timestamp = parseWechatTimestamp(lines[1]?.trim() ?? "");
    if (!timestamp) {
      return unsupportedRecord(recordIndex, "的时间格式不正确");
    }

    const body = trimOuterBlankLines(lines.slice(2).join("\n"));
    if (body.trim() === "") {
      return unsupportedRecord(recordIndex, "缺少正文");
    }

    if (isSystemNotification(body)) {
      continue;
    }

    let senderId = senderIdByName.get(senderName);
    if (!senderId) {
      if (participantNames.length >= 2) {
        return {
          success: false,
          error: {
            code: "INVALID_PARTICIPANT_COUNT",
            message: "当前只支持恰好两位参与者的微信聊天记录。",
          },
        };
      }
      senderId = participantNames.length === 0 ? "a" : "b";
      participantNames.push(senderName);
      senderIdByName.set(senderName, senderId);
    }

    const classifiedBody = classifyMessageBody(body);
    messages.push({
      id: `m-${String(messages.length + 1).padStart(4, "0")}`,
      senderId,
      timestamp,
      ...classifiedBody,
    });
  }

  if (participantNames.length !== 2) {
    return {
      success: false,
      error: {
        code: "INVALID_PARTICIPANT_COUNT",
        message: "当前只支持恰好两位参与者的微信聊天记录。",
      },
    };
  }

  const limitResult = validateChatLimits(messages);
  if (!limitResult.valid) {
    return { success: false, error: limitResult.error };
  }

  return {
    success: true,
    data: {
      participants: [
        { id: "a", displayName: participantNames[0] ?? "" },
        { id: "b", displayName: participantNames[1] ?? "" },
      ],
      messages,
    },
    stats: limitResult.stats,
  };
}

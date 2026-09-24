/** 有效消息的最小总数。 */
export const MIN_MESSAGE_COUNT = 8;

/** 每位参与者至少需要发送的有效消息数。 */
export const MIN_MESSAGES_PER_PARTICIPANT = 2;

/** 单次分析允许的最大消息数；超出后不会自动截断。 */
export const MAX_MESSAGE_COUNT = 500;

/** 所有规范化消息正文按 Unicode code point 计数的最大总长度。 */
export const MAX_NORMALIZED_CHARACTER_COUNT = 20_000;

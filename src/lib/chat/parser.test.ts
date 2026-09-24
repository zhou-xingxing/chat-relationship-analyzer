import { describe, expect, it } from "vitest";

import {
  INVALID_DATE_WECHAT_CHAT,
  INVALID_FREE_FORM_CHAT,
  MULTILINE_MEDIA_DUPLICATE_WECHAT_CHAT,
  TOO_SMALL_WECHAT_CHAT,
  VALID_WECHAT_CHAT,
} from "@/test/fixtures/wechat-chat";
import { parseWechatChat } from "@/lib/chat/parser";
import {
  classifyMessageBody,
  countUnicodeCodePoints,
  parseWechatTimestamp,
} from "@/lib/chat/normalize";

describe("parseWechatChat", () => {
  it("按首次出现顺序识别两位参与者并保留消息顺序", () => {
    const result = parseWechatChat(VALID_WECHAT_CHAT.replaceAll("\n", "\r\n"));

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.participants).toEqual([
      { id: "a", displayName: "小岚" },
      { id: "b", displayName: "阿澄" },
    ]);
    expect(result.data.messages).toHaveLength(8);
    expect(result.data.messages[0]).toEqual({
      id: "m-0001",
      senderId: "a",
      timestamp: "2026-09-18T09:00:00+08:00",
      kind: "text",
      text: "早上好，今天一起核对活动清单吗？",
    });
    expect(result.stats.participantMessageCounts).toEqual({ a: 4, b: 4 });
  });

  it("将单数字小时识别为新记录并规范化为双数字小时", () => {
    const singleDigitHourChat = VALID_WECHAT_CHAT.replaceAll("日 09:", "日 9:");
    const result = parseWechatChat(singleDigitHourChat);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.messages).toHaveLength(8);
    expect(result.data.messages[0]?.timestamp).toBe("2026-09-18T09:00:00+08:00");
    expect(result.data.messages[1]?.text).toBe("可以，我十点前整理好。");
  });

  it("识别日期后的连续空格和动画表情占位符", () => {
    const doubleSpacedChat = VALID_WECHAT_CHAT.replaceAll("日 09:", "日  9:").replace(
      "收到，谢谢。",
      "[动画表情]",
    );
    const result = parseWechatChat(doubleSpacedChat);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.messages).toHaveLength(8);
    expect(result.data.messages[0]?.timestamp).toBe("2026-09-18T09:00:00+08:00");
    expect(result.data.messages[7]).toMatchObject({ kind: "sticker", text: "[贴纸]" });
  });

  it("保留多行正文和真实重复消息，规范化媒体，并在计数前过滤系统通知", () => {
    const result = parseWechatChat(MULTILINE_MEDIA_DUPLICATE_WECHAT_CHAT);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.messages).toHaveLength(8);
    expect(result.data.messages[0]?.text).toBe("第一行说明\n第二行继续说明");
    expect(result.data.messages.map(({ kind }) => kind)).toEqual([
      "text",
      "image",
      "emoji",
      "sticker",
      "text",
      "text",
      "voice",
      "file",
    ]);
    expect(result.data.messages[4]?.text).toBe("重复内容");
    expect(result.data.messages[5]?.text).toBe("重复内容");
    expect(result.data.messages[4]?.id).not.toBe(result.data.messages[5]?.id);
  });

  it("保留多行正文内部的空白段，不把它拆成新记录", () => {
    const withParagraphBreak = VALID_WECHAT_CHAT.replace(
      "早上好，今天一起核对活动清单吗？",
      "早上好，今天一起核对活动清单吗？\n\n这里是同一条消息的第二段。",
    );
    const result = parseWechatChat(withParagraphBreak);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.messages).toHaveLength(8);
    expect(result.data.messages[0]?.text).toContain("\n\n这里是同一条消息的第二段。");
  });

  it("拒绝任意昵称冒号格式与非法日期，并定位出错记录", () => {
    const freeFormResult = parseWechatChat(INVALID_FREE_FORM_CHAT);
    const invalidDateResult = parseWechatChat(INVALID_DATE_WECHAT_CHAT);

    expect(freeFormResult).toMatchObject({
      success: false,
      error: { code: "INVALID_RECORD", recordIndex: 1 },
    });
    expect(invalidDateResult).toMatchObject({
      success: false,
      error: { code: "INVALID_RECORD", recordIndex: 1 },
    });
  });

  it("在本地拒绝样本不足", () => {
    expect(parseWechatChat(TOO_SMALL_WECHAT_CHAT)).toMatchObject({
      success: false,
      error: { code: "SAMPLE_TOO_SMALL" },
    });
    expect(parseWechatChat(TOO_SMALL_WECHAT_CHAT.replaceAll("日 08:", "日 8:"))).toMatchObject({
      success: false,
      error: { code: "SAMPLE_TOO_SMALL" },
    });
  });

  it("不截断超过消息数量或规范化字符上限的内容", () => {
    const tooManyRecords = Array.from({ length: 501 }, (_, index) => {
      const sender = index % 2 === 0 ? "小岚" : "阿澄";
      return `${sender}\n2026年09月20日 10:00\n第 ${index + 1} 条`;
    }).join("\n\n");
    const tooLongRecords = Array.from({ length: 8 }, (_, index) => {
      const sender = index % 2 === 0 ? "小岚" : "阿澄";
      return `${sender}\n2026年09月20日 10:00\n${"文".repeat(2_501)}`;
    }).join("\n\n");

    expect(parseWechatChat(tooManyRecords)).toMatchObject({
      success: false,
      error: { code: "PAYLOAD_TOO_LARGE" },
    });
    expect(parseWechatChat(tooLongRecords)).toMatchObject({
      success: false,
      error: { code: "PAYLOAD_TOO_LARGE" },
    });
  });
});

describe("聊天规范化", () => {
  it("只将已知的完整方括号标记识别为表情或媒体", () => {
    expect(classifyMessageBody("[微笑]")).toEqual({
      kind: "emoji",
      text: "[微笑]",
    });
    expect(classifyMessageBody("[自定义状态]")).toEqual({
      kind: "text",
      text: "[自定义状态]",
    });
    expect(classifyMessageBody("[动画表情]")).toEqual({
      kind: "sticker",
      text: "[贴纸]",
    });
    expect(classifyMessageBody("说明 [动画表情] 的位置")).toEqual({
      kind: "text",
      text: "说明 [动画表情] 的位置",
    });
    expect(classifyMessageBody("补充一张 [图片] 说明")).toEqual({
      kind: "text",
      text: "补充一张 [图片] 说明",
    });
  });

  it("校验真实日历日期并按 Unicode code point 计数", () => {
    expect(parseWechatTimestamp("2026年09月22日 0:06")).toBe(
      "2026-09-22T00:06:00+08:00",
    );
    expect(parseWechatTimestamp("2026年09月22日 00:06")).toBe(
      "2026-09-22T00:06:00+08:00",
    );
    expect(parseWechatTimestamp("2026年09月22日  0:06")).toBe(
      "2026-09-22T00:06:00+08:00",
    );
    expect(parseWechatTimestamp("2026年09月22日\t0:06")).toBeNull();
    expect(parseWechatTimestamp("2026年09月22日 24:06")).toBeNull();
    expect(parseWechatTimestamp("2024年02月29日 23:59")).toBe(
      "2024-02-29T23:59:00+08:00",
    );
    expect(parseWechatTimestamp("2025年02月29日 23:59")).toBeNull();
    expect(countUnicodeCodePoints("A😀中")).toBe(3);
  });
});

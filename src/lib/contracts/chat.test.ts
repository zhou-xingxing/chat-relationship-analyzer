import { describe, expect, it } from "vitest";

import { ChatMessageSchema, ParticipantsSchema } from "@/lib/contracts/chat";

const baseMessage = {
  id: "m-0001",
  senderId: "a",
  timestamp: "2026-09-18T09:00:00+08:00",
  kind: "text",
  text: "普通消息",
} as const;

describe("ChatMessageSchema", () => {
  it("拒绝未知字段、非法日期和消息类型与占位符不一致", () => {
    expect(ChatMessageSchema.safeParse({ ...baseMessage, extra: true }).success).toBe(
      false,
    );
    expect(
      ChatMessageSchema.safeParse({
        ...baseMessage,
        timestamp: "2026-02-30T09:00:00+08:00",
      }).success,
    ).toBe(false);
    expect(
      ChatMessageSchema.safeParse({ ...baseMessage, kind: "text", text: " [图片] " })
        .success,
    ).toBe(false);
    expect(
      ChatMessageSchema.safeParse({ ...baseMessage, kind: "text", text: "   " })
        .success,
    ).toBe(false);
    expect(
      ChatMessageSchema.safeParse({
        ...baseMessage,
        kind: "image",
        text: "一张 [图片]",
      }).success,
    ).toBe(false);
    expect(
      ChatMessageSchema.safeParse({
        ...baseMessage,
        kind: "text",
        text: "[微笑]",
      }).success,
    ).toBe(false);
  });

  it("接受规范化媒体消息与唯一表情标记", () => {
    expect(
      ChatMessageSchema.safeParse({ ...baseMessage, kind: "image", text: "[图片]" })
        .success,
    ).toBe(true);
    expect(
      ChatMessageSchema.safeParse({ ...baseMessage, kind: "emoji", text: "[微笑]" })
        .success,
    ).toBe(true);
    expect(
      ChatMessageSchema.safeParse({ ...baseMessage, kind: "text", text: "[自定义状态]" })
        .success,
    ).toBe(true);
    expect(
      ChatMessageSchema.safeParse({
        ...baseMessage,
        kind: "emoji",
        text: "[自定义状态]",
      }).success,
    ).toBe(false);
  });
});

describe("ParticipantsSchema", () => {
  it("要求 meId 与 otherId 不同且完整覆盖两位参与者", () => {
    expect(ParticipantsSchema.safeParse({ meId: "a", otherId: "b" }).success).toBe(
      true,
    );
    expect(ParticipantsSchema.safeParse({ meId: "a", otherId: "a" }).success).toBe(
      false,
    );
  });
});

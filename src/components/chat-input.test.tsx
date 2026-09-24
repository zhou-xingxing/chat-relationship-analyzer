// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatInput } from "./chat-input";
import { ChatPreview } from "./chat-preview";
import { ThirdPartyConsent } from "./third-party-consent";

afterEach(cleanup);

describe("ChatInput", () => {
  it("用可见标签暴露输入框，并允许提交不完整内容以显示校验错误", () => {
    const onSubmit = vi.fn();
    render(<ChatInput value="" error={null} onChange={vi.fn()} onSubmit={onSubmit} />);

    expect(screen.getByLabelText("聊天记录")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /在本地解析/ }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("支持从多行输入框使用键盘快捷键提交", () => {
    const onSubmit = vi.fn();
    render(<ChatInput value="示例" error={null} onChange={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.keyDown(screen.getByLabelText("聊天记录"), {
      key: "Enter",
      ctrlKey: true,
    });

    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("出现字段错误时关联错误说明并聚焦输入框", () => {
    const { rerender } = render(
      <ChatInput value="" error={null} onChange={vi.fn()} onSubmit={vi.fn()} />,
    );

    rerender(
      <ChatInput
        value="不支持的内容"
        error="暂不支持这种聊天复制格式"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    const textarea = screen.getByLabelText("聊天记录");
    expect(textarea).toHaveAttribute("aria-invalid", "true");
    expect(textarea).toHaveFocus();
    expect(screen.getByText("暂不支持这种聊天复制格式")).toBeInTheDocument();
  });
});

describe("ThirdPartyConsent", () => {
  it("错误出现时聚焦第三方处理确认框", () => {
    const { rerender } = render(
      <ThirdPartyConsent
        checked={false}
        error={null}
        onCheckedChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    rerender(
      <ThirdPartyConsent
        checked={false}
        error="请先确认第三方处理说明"
        onCheckedChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole("checkbox")).toHaveFocus();
    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-invalid", "true");
  });
});

describe("ChatPreview", () => {
  it("不预选身份，明确展示 A/B，并提供可键盘聚焦的只读滚动区", () => {
    const onSelectMe = vi.fn();
    render(
      <ChatPreview
        participants={[
          { id: "a", displayName: "小林" },
          { id: "b", displayName: "阿遥" },
        ]}
        messages={[
          {
            id: "m-0001",
            senderId: "a",
            timestamp: "2026-09-21T20:10:00+08:00",
            kind: "text",
            text: "示例消息",
          },
        ]}
        meId={null}
        error={null}
        onSelectMe={onSelectMe}
        onBack={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "确认消息和身份" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "只读消息预览" })).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByText("9/21 20:10")).toBeInTheDocument();
    const options = screen.getAllByRole("radio");
    expect(options).toHaveLength(2);
    expect(options[0]).not.toBeChecked();
    expect(options[1]).not.toBeChecked();
    expect(screen.getByText("身份尚未确认，请选择 A 或 B。")).toBeInTheDocument();
    fireEvent.click(options[1]);
    expect(onSelectMe).toHaveBeenCalledWith("b");
  });

  it("身份错误出现时关联说明并聚焦第一个选项", () => {
    const props = {
      participants: [
        { id: "a" as const, displayName: "小林" },
        { id: "b" as const, displayName: "阿遥" },
      ],
      messages: [],
      meId: null,
      onSelectMe: vi.fn(),
      onBack: vi.fn(),
    };
    const { rerender } = render(<ChatPreview {...props} error={null} />);
    rerender(<ChatPreview {...props} error="请选择 A 或 B，确认哪位是你。" />);

    const firstOption = screen.getAllByRole("radio")[0];
    expect(firstOption).toHaveFocus();
    expect(firstOption).toHaveAttribute("aria-describedby", "identity-error");
    expect(screen.getByText("请选择 A 或 B，确认哪位是你。")).toBeInTheDocument();
  });
});

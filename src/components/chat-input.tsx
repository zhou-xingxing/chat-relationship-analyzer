"use client";

import React, { useEffect, useRef } from "react";
import { ArrowRight, ClipboardPaste } from "lucide-react";

interface ChatInputProps {
  value: string;
  error: string | null;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

export function ChatInput({ value, error, onChange, onSubmit }: ChatInputProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (error) inputRef.current?.focus();
  }, [error]);

  return (
    <section className="input-panel" aria-labelledby="input-heading">
      <div className="section-kicker">01 · 放入片段</div>
      <div className="section-heading-row">
        <div>
          <h2 id="input-heading">粘贴微信聊天文本</h2>
          <p>
            目前只支持微信桌面端复制的两人聊天。解析会先在你的浏览器中完成，确认提交前不会调用外部模型。
          </p>
        </div>
        <ClipboardPaste className="section-icon" aria-hidden="true" />
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label className="field-label" htmlFor="chat-content">
          聊天记录
        </label>
        <textarea
          ref={inputRef}
          id="chat-content"
          name="chat-content"
          className="chat-textarea"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              onSubmit();
            }
          }}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "chat-error chat-format-hint" : "chat-format-hint"}
          placeholder={"发送者昵称\n2026年09月21日 20:10\n消息正文\n\n下一条消息……"}
          rows={14}
          spellCheck="false"
        />
        <div className="field-meta">
          <p id="chat-format-hint">每条记录依次为昵称、中文日期时间和正文，记录之间留空行。</p>
          <span aria-label={`${value.length} 个字符`}>{value.length.toLocaleString("zh-CN")} 字符</span>
        </div>
        {error ? (
          <p className="field-error" id="chat-error">
            <span aria-hidden="true">!</span>
            {error}
          </p>
        ) : null}
        <button className="primary-button" type="submit">
          在本地解析
          <ArrowRight aria-hidden="true" />
        </button>
      </form>
    </section>
  );
}

"use client";

import React, { useEffect, useRef } from "react";
import { ChevronLeft, LockKeyhole } from "lucide-react";
import type { ChatMessage, ParticipantId } from "@/lib/contracts/chat";

interface PreviewParticipant {
  id: ParticipantId;
  displayName: string;
}

interface ChatPreviewProps {
  participants: PreviewParticipant[];
  messages: ChatMessage[];
  meId: ParticipantId | null;
  error: string | null;
  onSelectMe: (id: ParticipantId) => void;
  onBack: () => void;
}

function messageKindLabel(kind: ChatMessage["kind"]) {
  return {
    text: "文字",
    emoji: "表情",
    image: "图片",
    sticker: "贴纸",
    voice: "语音",
    file: "文件",
  }[kind];
}

export function ChatPreview({
  participants,
  messages,
  meId,
  error,
  onSelectMe,
  onBack,
}: ChatPreviewProps) {
  const firstIdentityOptionRef = useRef<HTMLInputElement>(null);
  const participantNames = Object.fromEntries(
    participants.map((participant) => [participant.id, participant.displayName]),
  ) as Record<ParticipantId, string>;

  useEffect(() => {
    if (error) firstIdentityOptionRef.current?.focus();
  }, [error]);

  return (
    <section className="preview-panel" aria-labelledby="preview-heading">
      <div className="section-kicker">02 · 核对解析</div>
      <div className="section-heading-row">
        <div>
          <h1 id="preview-heading">确认消息和身份</h1>
          <p>预览内容不可编辑。如果解析有误，请返回修改原始文本。</p>
        </div>
        <LockKeyhole className="section-icon" aria-hidden="true" />
      </div>

      <fieldset className="identity-card" aria-describedby={error ? "identity-help identity-error" : "identity-help"}>
        <legend>哪位是你？</legend>
        <p id="identity-help">
          A 是首位有效消息的发送者，B 是另一位。请按昵称选择，系统不会自动判断谁是你。
        </p>
        <div className="identity-options">
          {participants.map((participant) => (
            <label
              className={`identity-option${meId === participant.id ? " is-selected" : ""}`}
              key={participant.id}
            >
              <input
                ref={participant.id === "a" ? firstIdentityOptionRef : undefined}
                type="radio"
                name="identity-me"
                value={participant.id}
                checked={meId === participant.id}
                onChange={() => onSelectMe(participant.id)}
                aria-describedby={error ? "identity-error" : undefined}
              />
              <span>
                <span className="identity-label">{participant.id.toUpperCase()}</span>
                <strong>{participant.displayName}</strong>
              </span>
            </label>
          ))}
        </div>
        <p className="identity-mapping" role="status">
          {meId
            ? `已确认：A（${participantNames.a}）是${meId === "a" ? "我" : "对方"}，B（${participantNames.b}）是${meId === "b" ? "我" : "对方"}。`
            : "身份尚未确认，请选择 A 或 B。"}
        </p>
        {error ? (
          <p className="field-error" id="identity-error">
            <span aria-hidden="true">!</span>
            {error}
          </p>
        ) : null}
      </fieldset>

      <div className="preview-summary">
        <strong>{messages.length} 条有效消息</strong>
        <span>已排除可识别的系统通知</span>
      </div>

      <ol className="message-list" aria-label="只读消息预览" tabIndex={0}>
        {messages.map((message) => {
          const isMe = message.senderId === meId;
          return (
            <li className={isMe ? "message-row is-me" : "message-row"} key={message.id}>
              <div className="message-meta">
                <strong>
                  {message.senderId.toUpperCase()}
                  {meId ? ` · ${isMe ? "我" : "对方"}` : ""}
                </strong>
                <span>{participantNames[message.senderId]}</span>
                <time dateTime={message.timestamp}>
                  {new Intl.DateTimeFormat("zh-CN", {
                    timeZone: "Asia/Shanghai",
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(message.timestamp))}
                </time>
              </div>
              <p>{message.text}</p>
              {message.kind !== "text" ? (
                <span className="message-kind">{messageKindLabel(message.kind)}</span>
              ) : null}
            </li>
          );
        })}
      </ol>

      <button className="text-button" type="button" onClick={onBack}>
        <ChevronLeft aria-hidden="true" />
        返回修改原文
      </button>
    </section>
  );
}

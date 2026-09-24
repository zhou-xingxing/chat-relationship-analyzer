"use client";

import React, { useEffect, useRef } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";

interface ThirdPartyConsentProps {
  checked: boolean;
  error: string | null;
  onCheckedChange: (checked: boolean) => void;
  onSubmit: () => void;
}

export function ThirdPartyConsent({
  checked,
  error,
  onCheckedChange,
  onSubmit,
}: ThirdPartyConsentProps) {
  const checkboxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (error) checkboxRef.current?.focus();
  }, [error]);

  return (
    <section className="consent-panel" aria-labelledby="consent-heading">
      <div className="consent-title">
        <ShieldCheck aria-hidden="true" />
        <div>
          <h2 id="consent-heading">提交前，请确认第三方处理</h2>
          <p>
            消息正文会发送到 TypeSafe 和 DeepSeek，用于本次互动分析与关系解读；第三方处理和留存遵循其各自条款。本应用不保存聊天历史。
          </p>
        </div>
      </div>
      <label className="consent-check">
        <input
          ref={checkboxRef}
          type="checkbox"
          checked={checked}
          onChange={(event) => onCheckedChange(event.target.checked)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "consent-error" : undefined}
        />
        <span>我已了解并同意将本次聊天发送给上述第三方处理</span>
      </label>
      {error ? (
        <p className="field-error" id="consent-error">
          <span aria-hidden="true">!</span>
          {error}
        </p>
      ) : null}
      <button className="primary-button" type="button" onClick={onSubmit}>
        开始分析
        <ArrowRight aria-hidden="true" />
      </button>
    </section>
  );
}

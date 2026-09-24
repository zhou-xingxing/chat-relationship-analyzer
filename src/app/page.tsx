"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, FileSearch, RotateCcw } from "lucide-react";
import { AnalysisLoading } from "@/components/analysis-loading";
import { ChatInput } from "@/components/chat-input";
import { ChatPreview } from "@/components/chat-preview";
import { ExplanationResult } from "@/components/explanation-result";
import { InteractionResult } from "@/components/interaction-result";
import { RelationshipResult } from "@/components/relationship-result";
import { ThirdPartyConsent } from "@/components/third-party-consent";
import { parseWechatChat, type ParseWechatChatResult } from "@/lib/chat/parser";
import type {
  ExplanationResponse,
  SignalAnalysisResponse,
} from "@/lib/contracts/analysis";
import {
  ExplanationResponseSchema,
  SignalAnalysisResponseSchema,
} from "@/lib/contracts/analysis";
import type { ParticipantId } from "@/lib/contracts/chat";

type ParsedChat = Extract<ParseWechatChatResult, { success: true }>["data"];
type Phase =
  | "input"
  | "preview"
  | "analyzing_signals"
  | "generating_explanation"
  | "complete"
  | "explanation_error";

function publicApiError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return fallback;
  const error = payload.error;
  if (!error || typeof error !== "object") return fallback;
  return "message" in error && typeof error.message === "string" ? error.message : fallback;
}

function apiErrorCode(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return null;
  const error = payload.error;
  if (!error || typeof error !== "object") return null;
  return "code" in error && typeof error.code === "string" ? error.code : null;
}

export default function Home() {
  const [rawText, setRawText] = useState("");
  const [parsed, setParsed] = useState<ParsedChat | null>(null);
  const [meId, setMeId] = useState<ParticipantId | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("input");
  const [parseError, setParseError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [signals, setSignals] = useState<SignalAnalysisResponse | null>(null);
  const [explanation, setExplanation] = useState<ExplanationResponse | null>(null);
  const [contextUnavailable, setContextUnavailable] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const requestController = useRef<AbortController | null>(null);

  useEffect(() => () => requestController.current?.abort(), []);

  useEffect(() => {
    if (!signals || contextUnavailable) return;
    const markContextUnavailable = () => {
      setContextUnavailable(true);
      if (phase === "explanation_error") {
        setRequestError("当前分析上下文已失效，请重新运行完整分析。");
      }
    };
    const expiryMs = signals.meta.analysisContextExpiresAt * 1000;
    const remaining = expiryMs - Date.now();
    if (remaining <= 0) {
      markContextUnavailable();
      return;
    }
    const timer = window.setTimeout(markContextUnavailable, remaining);
    return () => window.clearTimeout(timer);
  }, [signals, contextUnavailable, phase]);

  const participants = parsed && meId
    ? { meId, otherId: (meId === "a" ? "b" : "a") as ParticipantId }
    : null;

  function handleParse() {
    setParseError(null);
    const result = parseWechatChat(rawText);
    if (!result.success) {
      setParseError(result.error.message);
      setStatusMessage(`解析失败：${result.error.message}`);
      return;
    }
    setParsed(result.data);
    setMeId(null);
    setIdentityError(null);
    setConsent(false);
    setConsentError(null);
    setSignals(null);
    setExplanation(null);
    setContextUnavailable(false);
    setPhase("preview");
    setStatusMessage(`已在本地解析 ${result.data.messages.length} 条有效消息，请核对身份。`);
  }

  async function requestExplanation(
    signalResult: SignalAnalysisResponse,
    controller: AbortController,
  ) {
    if (!parsed || !participants) return;
    setPhase("generating_explanation");
    setStatusMessage("互动分析已完成，正在根据以上结果生成关系解读。");
    try {
      const response = await fetch("/api/analyze/explanation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({
          participants,
          messages: parsed.messages,
          analysisContext: signalResult.analysisContext,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const isUnavailable = apiErrorCode(payload) === "ANALYSIS_CONTEXT_UNAVAILABLE";
        setContextUnavailable(isUnavailable);
        setRequestError(
          isUnavailable
            ? "当前分析上下文已失效，请重新运行完整分析。"
            : publicApiError(payload, "互动分析已完成，但关系解读暂时生成失败。"),
        );
        setPhase("explanation_error");
        setStatusMessage("互动分析已完成，但关系解读暂时生成失败。");
        return;
      }
      const parsedResponse = ExplanationResponseSchema.safeParse(payload);
      if (!parsedResponse.success) {
        setRequestError("互动分析已完成，但关系解读暂时生成失败。");
        setPhase("explanation_error");
        setStatusMessage("互动分析已完成，但关系解读响应无效。");
        return;
      }
      const result: ExplanationResponse = parsedResponse.data;
      setExplanation(result);
      setRequestError(null);
      setPhase("complete");
      setStatusMessage("关系解读已生成。");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setRequestError("互动分析已完成，但关系解读暂时生成失败。");
      setPhase("explanation_error");
      setStatusMessage("互动分析已完成，但关系解读暂时生成失败。");
    }
  }

  async function runFullAnalysis() {
    if (!parsed) return;
    if (!participants) {
      setIdentityError("请选择 A 或 B，确认哪位是你。");
      setStatusMessage("请先确认 A、B 分别代表谁。");
      return;
    }
    if (!consent) {
      setConsentError("请先确认第三方处理说明，再开始分析。");
      return;
    }

    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setConsentError(null);
    setRequestError(null);
    setSignals(null);
    setExplanation(null);
    setContextUnavailable(false);
    setPhase("analyzing_signals");
    setStatusMessage("正在分析互动信号。");

    try {
      const response = await fetch("/api/analyze/signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({ participants, messages: parsed.messages }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = publicApiError(payload, "暂时无法完成互动分析，请稍后重试。");
        setRequestError(message);
        setPhase("preview");
        setStatusMessage(`互动分析失败：${message}`);
        return;
      }
      const parsedResponse = SignalAnalysisResponseSchema.safeParse(payload);
      if (!parsedResponse.success) {
        setRequestError("暂时无法完成互动分析，请稍后重试。");
        setPhase("preview");
        setStatusMessage("互动分析响应无效，请稍后重试。");
        return;
      }
      const result: SignalAnalysisResponse = parsedResponse.data;
      setSignals(result);
      await requestExplanation(result, controller);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setRequestError("暂时无法完成互动分析，请检查网络后重试。");
      setPhase("preview");
      setStatusMessage("互动分析失败，请检查网络后重试。");
    }
  }

  async function retryExplanation() {
    if (!signals) return;
    if (Date.now() >= signals.meta.analysisContextExpiresAt * 1000) {
      setContextUnavailable(true);
      setRequestError("当前分析上下文已失效，请重新运行完整分析。");
      return;
    }
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setRequestError(null);
    await requestExplanation(signals, controller);
  }

  function startAnotherAnalysis() {
    requestController.current?.abort();
    setRawText("");
    setParsed(null);
    setMeId(null);
    setIdentityError(null);
    setSignals(null);
    setExplanation(null);
    setConsent(false);
    setParseError(null);
    setRequestError(null);
    setContextUnavailable(false);
    setPhase("input");
    setStatusMessage("可以粘贴新的聊天片段。");
  }

  const isResultsPhase =
    phase === "generating_explanation" || phase === "complete" || phase === "explanation_error";

  return (
    <>
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <div className="site-shell">
        <header className="site-header">
          <Link className="wordmark" href="/" translate="no">
            <span aria-hidden="true">CRA</span>
            Chat Relationship Analyzer
          </Link>
          <p>服务端不会保存您的任何聊天记录</p>
        </header>

        <main id="main-content">
          <div className="sr-only" role="status">
            {statusMessage}
          </div>

          {phase === "input" ? (
            <>
              <section className="hero" id="top" aria-labelledby="page-title">
                <p className="hero-kicker">一份关于互动本身的观察</p>
                <h1 id="page-title">
                  看见聊天里的
                  <br />
                  <em>互动脉络</em>
                </h1>
                <p className="hero-tech">基于 Jev 和 DeepSeek 模型进行分析</p>
                <p className="hero-intro">
                  粘贴一段两人的微信聊天，让关系场景的线索、话语间的温度、回应的节奏与支持的痕迹慢慢浮现。这里只描摹眼前的片段，不揣测任何人的内心。
                </p>
                <p className="hero-tagline" lang="en">
                  Paste a conversation. See the interaction patterns.
                </p>
              </section>
              <ChatInput
                value={rawText}
                error={parseError}
                onChange={(value) => {
                  setRawText(value);
                  if (parseError) setParseError(null);
                }}
                onSubmit={handleParse}
              />
            </>
          ) : null}

          {phase === "preview" && parsed ? (
            <div className="workflow-grid">
              <ChatPreview
                participants={parsed.participants}
                messages={parsed.messages}
                meId={meId}
                error={identityError}
                onSelectMe={(selectedId) => {
                  setMeId(selectedId);
                  setIdentityError(null);
                }}
                onBack={() => {
                  setPhase("input");
                  setRequestError(null);
                }}
              />
              <div className="workflow-side">
                <div className="step-note">
                  <span>本地预览</span>
                  <p>此时尚未向 TypeSafe 或 DeepSeek 发送任何内容。</p>
                </div>
                {requestError ? (
                  <div className="request-error" role="alert">
                    <strong>分析未完成</strong>
                    <p>{requestError}</p>
                  </div>
                ) : null}
                <ThirdPartyConsent
                  checked={consent}
                  error={consentError}
                  onCheckedChange={(checked) => {
                    setConsent(checked);
                    if (checked) setConsentError(null);
                  }}
                  onSubmit={runFullAnalysis}
                />
              </div>
            </div>
          ) : null}

          {phase === "analyzing_signals" ? (
            <div className="analysis-stage">
              <AnalysisLoading stage="signals" />
            </div>
          ) : null}

          {isResultsPhase && signals && parsed && meId ? (
            <article className="report" aria-labelledby="report-title">
              <header className="report-cover">
                <div>
                  <p>互动观察报告</p>
                  <h1 id="report-title">这段聊天，呈现出怎样的互动？</h1>
                  <span>
                    样本 {signals.meta.messageCount} 条消息 · 分析口径 {signals.meta.analysisRulesetVersion}
                  </span>
                  <p className="report-participant-key">
                    本报告中，A（{parsed.participants[0].displayName}）代表
                    {meId === "a" ? "我" : "对方"}，B（{parsed.participants[1].displayName}）代表
                    {meId === "b" ? "我" : "对方"}。
                  </p>
                </div>
                <button className="secondary-button" type="button" onClick={startAnotherAnalysis}>
                  分析另一段
                  <ArrowRight aria-hidden="true" />
                </button>
              </header>

              <RelationshipResult result={signals.relationshipClassification} />
              <InteractionResult
                dimensions={signals.dimensions}
                balance={signals.derivedSignals.interactionBalance}
                interactionIndex={signals.interactionIndex}
              />

              {phase === "generating_explanation" ? <AnalysisLoading stage="explanation" /> : null}
              {phase === "complete" && explanation && parsed ? (
                <ExplanationResult
                  explanation={explanation.relationshipExplanation}
                  messages={parsed.messages}
                  meId={meId}
                  dimensions={signals.dimensions}
                />
              ) : null}
              {phase === "explanation_error" ? (
                <section className="recovery-panel" aria-labelledby="recovery-heading">
                  <FileSearch aria-hidden="true" />
                  <div>
                    <span>互动分析已保留</span>
                    <h2 id="recovery-heading">
                      {contextUnavailable ? "需要重新运行完整分析" : "关系解读暂时生成失败"}
                    </h2>
                    <p>{requestError}</p>
                    <button
                      className="primary-button"
                      type="button"
                      onClick={contextUnavailable ? runFullAnalysis : retryExplanation}
                    >
                      <RotateCcw aria-hidden="true" />
                      {contextUnavailable ? "重新运行完整分析" : "重新生成解读"}
                    </button>
                  </div>
                </section>
              ) : null}
            </article>
          ) : null}
        </main>

        <footer className="site-footer">
          <p>只分析当前聊天片段中可观察到的互动，不确认现实关系身份。</p>
          <span>Chat Relationship Analyzer · MVP</span>
        </footer>
      </div>
    </>
  );
}

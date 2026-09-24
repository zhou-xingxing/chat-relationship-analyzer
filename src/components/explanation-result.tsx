import React from "react";
import { BookOpenText, Quote } from "lucide-react";
import type { ExplanationResponse, SignalAnalysisResponse } from "@/lib/contracts/analysis";
import type { ChatMessage, ParticipantId } from "@/lib/contracts/chat";

type Explanation = ExplanationResponse["relationshipExplanation"];
type Interpretation = Explanation["dimensionInterpretations"][number];
type InterpretationGroupId = "a" | "b" | "overall";
type DimensionLabel = Pick<SignalAnalysisResponse["dimensions"][number], "dimensionId" | "label">;

const interpretationGroups = [
  { id: "a", title: "A 的分析", scope: "A", emptyText: "本次解读未单独展开 A 的关键维度。" },
  { id: "b", title: "B 的分析", scope: "B", emptyText: "本次解读未单独展开 B 的关键维度。" },
  {
    id: "overall",
    title: "整体互动分析",
    scope: "整体互动",
    emptyText: "本次解读未单独展开整体互动的关键维度。",
  },
] as const;

interface ExplanationResultProps {
  explanation: Explanation;
  messages: ChatMessage[];
  meId: ParticipantId;
  dimensions: readonly DimensionLabel[];
}

function interpretationGroupId(dimensionId: Interpretation["dimensionId"]): InterpretationGroupId {
  if (dimensionId === "a_engagement" || dimensionId === "a_warmth") return "a";
  if (dimensionId === "b_engagement" || dimensionId === "b_warmth") return "b";
  return "overall";
}

export function ExplanationResult({ explanation, messages, meId, dimensions }: ExplanationResultProps) {
  const senderByMessageId = new Map(messages.map(({ id, senderId }) => [id, senderId]));
  const dimensionLabelById = new Map(dimensions.map(({ dimensionId, label }) => [dimensionId, label]));
  const roleFor = (id: ParticipantId) => (id === meId ? "我" : "对方");

  return (
    <section className="report-section explanation-section" aria-labelledby="explanation-heading">
      <div className="report-section-number">03</div>
      <div className="report-section-body">
        <div className="report-heading">
          <div>
            <span>关系解读</span>
            <h2 id="explanation-heading">{explanation.headline}</h2>
          </div>
          <BookOpenText aria-hidden="true" />
        </div>

        <p className="explanation-lead">{explanation.overview}</p>

        <div className="explanation-copy-grid">
          <article>
            <h3>如何理解场景匹配</h3>
            <p>{explanation.classificationExplanation}</p>
          </article>
          <article>
            <h3>如何理解集中度</h3>
            <p>{explanation.confidenceExplanation}</p>
          </article>
        </div>

        <div className="evidence-section">
          <h3>关键互动信号与原文证据</h3>
          <div className="interpretation-groups">
            {interpretationGroups.map((group) => {
              const interpretations = explanation.dimensionInterpretations.filter(
                (interpretation) => interpretationGroupId(interpretation.dimensionId) === group.id,
              );
              const groupLabel = group.id === "overall"
                ? group.title
                : `${group.scope}（${roleFor(group.id)}）的分析`;
              const scopeLabel = group.id === "overall"
                ? group.scope
                : `${group.scope}（${roleFor(group.id)}）`;

              return (
                <section
                  className="interpretation-group"
                  aria-labelledby={`interpretation-${group.id}-heading`}
                  key={group.id}
                >
                  <h4 className="interpretation-group-heading" id={`interpretation-${group.id}-heading`}>
                    {groupLabel}
                  </h4>
                  {interpretations.length > 0 ? (
                    <div className="interpretation-list">
                      {interpretations.map((interpretation) => (
                        <article className="interpretation-card" key={interpretation.dimensionId}>
                          <h5 className="interpretation-dimension">
                            {dimensionLabelById.get(interpretation.dimensionId) ?? "互动维度"}
                          </h5>
                          <p>
                            <strong className="interpretation-scope">{scopeLabel}：</strong>
                            {interpretation.explanation}
                          </p>
                          <div className="evidence-list">
                            {interpretation.evidence.map((evidence) => {
                              const senderId = senderByMessageId.get(evidence.messageId);
                              const senderLabel = senderId
                                ? `${senderId.toUpperCase()}（${roleFor(senderId)}）`
                                : "发送者未匹配";
                              return (
                                <blockquote key={evidence.messageId}>
                                  <Quote aria-hidden="true" />
                                  <p>
                                    <strong className="evidence-sender">{senderLabel}：</strong>
                                    {evidence.excerpt}
                                    {evidence.truncated ? "…" : ""}
                                  </p>
                                  <cite>消息证据 · {evidence.messageId}</cite>
                                </blockquote>
                              );
                            })}
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="interpretation-empty">{group.emptyText}</p>
                  )}
                </section>
              );
            })}
          </div>
        </div>

        {explanation.uncertainties.length > 0 ? (
          <aside className="uncertainty-block" aria-labelledby="uncertainties-heading">
            <h3 id="uncertainties-heading">仍需保留的不确定性</h3>
            <ul>
              {explanation.uncertainties.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </aside>
        ) : null}

        {explanation.caveats.length > 0 ? (
          <div className="caveat-list">
            {explanation.caveats.map((caveat) => (
              <p key={caveat}>{caveat}</p>
            ))}
          </div>
        ) : null}

        <p className="ground-truth-note">
          以下解读基于模型判断，不代表现实关系事实，也不构成心理诊断或行动建议。
        </p>
      </div>
    </section>
  );
}

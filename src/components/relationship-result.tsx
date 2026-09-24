import { CircleAlert, GitBranch, Sparkles } from "lucide-react";
import React, { type CSSProperties } from "react";
import type { SignalAnalysisResponse } from "@/lib/contracts/analysis";

type RelationshipResultData = SignalAnalysisResponse["relationshipClassification"];

interface RelationshipResultProps {
  result: RelationshipResultData;
}

interface ProbabilityBarsProps {
  label: string;
  probabilities: Array<{ id: string; label: string; probability: number }>;
  selectedId: string;
}

function ProbabilityBars({ label, probabilities, selectedId }: ProbabilityBarsProps) {
  return (
    <div className="distribution" aria-label={label}>
      {probabilities.map((item) => {
        const percentage = Math.round(item.probability * 100);
        return (
          <div className="distribution-row" key={item.id}>
            <div className="distribution-label">
              <span>
                {item.label}
                {item.id === selectedId ? <em>当前最接近</em> : null}
              </span>
              <strong>{percentage}%</strong>
            </div>
            <div
              className="distribution-track"
              role="meter"
              aria-label={`${item.label}匹配度`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percentage}
            >
              <span
                className={item.id === selectedId ? "is-selected" : undefined}
                style={{ "--bar-value": `${percentage}%` } as CSSProperties}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

const skippedReason = {
  broad_unclear_or_other: "当前大类不适合继续细分",
  low_confidence: "主导场景的线索还不够集中",
  small_probability_margin: "前两类场景过于接近",
} as const;

export function RelationshipResult({ result }: RelationshipResultProps) {
  const broad = result.broad;

  return (
    <section className="report-section relationship-section" aria-labelledby="relationship-heading">
      <div className="report-section-number">01</div>
      <div className="report-section-body">
        <div className="report-heading">
          <div>
            <span>关系场景</span>
            <h2 id="relationship-heading">{broad.summary}</h2>
          </div>
          <Sparkles aria-hidden="true" />
        </div>

        <div className="confidence-note">
          <div>
            <strong>{Math.round(broad.confidence * 100)}%</strong>
            <span>模型分布集中度</span>
          </div>
          <p>
            集中度表示模型的匹配分布是否集中，不表示答案正确率。现实关系也可能同时具有多个身份。
          </p>
        </div>

        <h3>主导关系场景 · 模型匹配分布</h3>
        <ProbabilityBars
          label="主导关系场景模型匹配分布"
          probabilities={broad.probabilities}
          selectedId={broad.selectedId}
        />

        <div className="subtype-block">
          <div className="subtype-title">
            <GitBranch aria-hidden="true" />
            <h3>关系细分</h3>
          </div>
          {result.subtype.status === "available" ? (
            <>
              <p className="subtype-summary">{result.subtype.result.summary}</p>
              <ProbabilityBars
                label={`${broad.selectedLabel}细分模型匹配分布`}
                probabilities={result.subtype.result.probabilities}
                selectedId={result.subtype.result.selectedId}
              />
            </>
          ) : result.subtype.status === "temporarily_unavailable" ? (
            <p className="subtype-state">
              <CircleAlert aria-hidden="true" />
              细分暂时无法生成，主导场景和互动维度不受影响。
            </p>
          ) : (
            <p className="subtype-state">
              <CircleAlert aria-hidden="true" />
              暂不细分：{skippedReason[result.subtype.reason]}。
            </p>
          )}
        </div>

        <p className="ground-truth-note">
          这是对当前聊天场景的模型匹配结果，不代表现实关系事实。
        </p>
      </div>
    </section>
  );
}

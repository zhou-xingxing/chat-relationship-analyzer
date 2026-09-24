import React from "react";
import { Activity, Equal, Info } from "lucide-react";
import type { SignalAnalysisResponse } from "@/lib/contracts/analysis";

type Dimension = SignalAnalysisResponse["dimensions"][number];
type Metric = SignalAnalysisResponse["derivedSignals"]["interactionBalance"];
type InteractionIndex = SignalAnalysisResponse["interactionIndex"];

interface InteractionResultProps {
  dimensions: Dimension[];
  balance: Metric;
  interactionIndex: InteractionIndex;
}

function MetricCard({
  type,
  metric,
}: {
  type: "index" | "balance";
  metric: Metric | InteractionIndex;
}) {
  const isIndex = type === "index";
  return (
    <article className={isIndex ? "metric-card metric-primary" : "metric-card"}>
      <div className="metric-icon" aria-hidden="true">
        {isIndex ? <Activity /> : <Equal />}
      </div>
      <span>{isIndex ? "综合互动指数" : "互动平衡度"}</span>
      {metric.status === "available" ? (
        <>
          <div className="metric-value">
            <strong>{Math.round(metric.value)}</strong>
            <small>/ 100</small>
          </div>
          <p>{metric.label}</p>
          <span className="confidence-chip">
            {metric.confidenceBand === "high" ? "较高" : "中等"}证据集中度
          </span>
        </>
      ) : (
        <div className="metric-insufficient">
          <strong>证据不足</strong>
          <p>当前片段不足以稳定计算这一指标。</p>
        </div>
      )}
      <p className="metric-caption">
        {isIndex
          ? "产品内部的解释性指标，不代表关系质量或真实好感概率。"
          : "只描述当前样本中双方投入和温度是否相对均衡。"}
      </p>
    </article>
  );
}

function DimensionCard({ dimension }: { dimension: Dimension }) {
  if (dimension.status === "insufficient_evidence") {
    return (
      <article className="dimension-card is-insufficient">
        <div className="dimension-title">
          <h3>{dimension.label}</h3>
          <span>证据不足</span>
        </div>
        <p>模型没有得到足够一致的可观察信号，因此不展示分数。</p>
      </article>
    );
  }

  const selectedLevel = dimension.levels.find((level) => level.score === dimension.score);
  const strengthLabel = selectedLevel?.label ?? `${dimension.score} 级`;
  return (
    <article className="dimension-card">
      <div className="dimension-title">
        <h3>{dimension.label}</h3>
        <span>
          {dimension.confidenceBand === "medium" ? `可能为「${strengthLabel}」` : strengthLabel}
        </span>
      </div>
      <div
        className="level-scale"
        role="meter"
        aria-label={`${dimension.label}强度`}
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={dimension.score}
        aria-valuetext={selectedLevel?.label}
      >
        {[1, 2, 3, 4].map((level) => (
          <span
            className={level > 0 && level <= dimension.score ? "is-active" : undefined}
            key={level}
          />
        ))}
      </div>
      <div className="dimension-foot">
        <span>0 · 未观察到明显信号</span>
        <strong>{dimension.score} / 4</strong>
      </div>
    </article>
  );
}

export function InteractionResult({
  dimensions,
  balance,
  interactionIndex,
}: InteractionResultProps) {
  return (
    <section className="report-section" aria-labelledby="interaction-heading">
      <div className="report-section-number">02</div>
      <div className="report-section-body">
        <div className="report-heading">
          <div>
            <span>互动信号</span>
            <h2 id="interaction-heading">当前片段中的互动轮廓</h2>
          </div>
          <Activity aria-hidden="true" />
        </div>

        <div className="metric-grid">
          <MetricCard type="index" metric={interactionIndex} />
          <MetricCard type="balance" metric={balance} />
        </div>

        <div className="scale-explainer">
          <Info aria-hidden="true" />
          <p>
            十个维度使用 0～4 的强度量表。0 表示没有观察到明显信号；“证据不足”表示线索不够稳定，两者含义不同。
          </p>
        </div>

        <div className="dimension-grid">
          {dimensions.map((dimension) => (
            <DimensionCard dimension={dimension} key={dimension.dimensionId} />
          ))}
        </div>
      </div>
    </section>
  );
}

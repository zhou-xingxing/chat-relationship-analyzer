import React from "react";
import { LoaderCircle } from "lucide-react";

interface AnalysisLoadingProps {
  stage: "signals" | "explanation";
}

export function AnalysisLoading({ stage }: AnalysisLoadingProps) {
  const copy =
    stage === "signals"
      ? {
          eyebrow: "正在处理",
          title: "正在分析互动信号……",
          detail: "正在匹配关系场景并整理十项可观察的互动维度。",
        }
      : {
          eyebrow: "互动分析已完成",
          title: "正在根据以上结果生成关系解读……",
          detail: "解读只解释已经得到的分类、维度与指标，不会重新评分。",
        };

  return (
    <section className="loading-panel" aria-busy="true" aria-labelledby={`loading-${stage}`}>
      <LoaderCircle className="loading-icon" aria-hidden="true" />
      <div>
        <span>{copy.eyebrow}</span>
        {stage === "signals" ? (
          <h1 id={`loading-${stage}`}>{copy.title}</h1>
        ) : (
          <h2 id={`loading-${stage}`}>{copy.title}</h2>
        )}
        <p>{copy.detail}</p>
      </div>
    </section>
  );
}

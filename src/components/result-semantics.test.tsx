// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ExplanationResponse, SignalAnalysisResponse } from "@/lib/contracts/analysis";
import type { ChatMessage } from "@/lib/contracts/chat";
import { ExplanationResult } from "./explanation-result";
import { InteractionResult } from "./interaction-result";
import { RelationshipResult } from "./relationship-result";

afterEach(cleanup);

const probabilities: SignalAnalysisResponse["relationshipClassification"]["broad"]["probabilities"] = [
  { id: "romantic_or_partner", label: "浪漫或伴侣", probability: 0.2 },
  { id: "friendship", label: "朋友", probability: 0.3 },
  { id: "family", label: "家庭", probability: 0.1 },
  { id: "work_or_education", label: "工作或学校", probability: 0.1 },
  { id: "commercial_or_service", label: "交易或服务", probability: 0.1 },
  { id: "weak_tie_or_new_contact", label: "弱关系或新联系人", probability: 0.1 },
  { id: "other", label: "其他", probability: 0.05 },
  { id: "unclear", label: "信息不足", probability: 0.05 },
];

describe("RelationshipResult", () => {
  it("低集中度时突出不确定性，并保留细分降级结果", () => {
    const relationship = {
      broad: {
        selectedId: "friendship",
        selectedLabel: "朋友",
        probabilities,
        confidence: 0.32,
        summary: "服务端判定当前线索不足",
        confidenceBand: "insufficient",
      },
      subtype: { status: "temporarily_unavailable" },
      notGroundTruth: true,
    } satisfies SignalAnalysisResponse["relationshipClassification"];

    render(<RelationshipResult result={relationship} />);

    expect(
      screen.getByRole("heading", { name: "服务端判定当前线索不足" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/细分暂时无法生成/)).toBeInTheDocument();
    expect(screen.getAllByRole("meter")).toHaveLength(8);
    expect(screen.getByText(/不代表现实关系事实/)).toBeInTheDocument();
  });

  it("直接展示服务端提供的主导场景与关系细分摘要", () => {
    const relationship = {
      broad: {
        selectedId: "friendship",
        selectedLabel: "朋友",
        probabilities,
        confidence: 0.61,
        summary: "服务端主导场景摘要",
        confidenceBand: "low",
      },
      subtype: {
        status: "available",
        result: {
          selectedId: "ordinary_friend",
          selectedLabel: "普通朋友",
          probabilities: [
            { id: "close_friend", label: "亲密朋友", probability: 0.1 },
            { id: "ordinary_friend", label: "普通朋友", probability: 0.6 },
            { id: "new_friend", label: "新建立的朋友关系", probability: 0.1 },
            {
              id: "reconnecting_friend",
              label: "疏远或重新联系的朋友",
              probability: 0.1,
            },
            { id: "friendship_unclear", label: "无法细分", probability: 0.1 },
          ],
          confidence: 0.58,
          summary: "服务端关系细分摘要",
          confidenceBand: "medium",
        },
      },
      notGroundTruth: true,
    } satisfies SignalAnalysisResponse["relationshipClassification"];

    render(<RelationshipResult result={relationship} />);

    expect(
      screen.getByRole("heading", { name: "服务端主导场景摘要" }),
    ).toBeInTheDocument();
    expect(screen.getByText("服务端关系细分摘要")).toBeInTheDocument();
  });
});

describe("InteractionResult", () => {
  it("把零分和证据不足显示成两个不同状态", () => {
    type AvailableDimension = Extract<
      SignalAnalysisResponse["dimensions"][number],
      { status: "available" }
    >;
    const levels: AvailableDimension["levels"] = [
      { score: 0, label: "未观察到明显信号" },
      { score: 1, label: "少量或很弱" },
      { score: 2, label: "中等" },
      { score: 3, label: "较多且较一致" },
      { score: 4, label: "强烈且持续" },
    ];
    const probabilitiesByLevel = levels.map((level, index) => ({
      ...level,
      probability: index === 0 ? 1 : 0,
    }));
    const available: AvailableDimension = {
      dimensionId: "a_engagement",
      label: "我的投入度",
      confidence: 0.9,
      status: "available",
      score: 0,
      confidenceBand: "medium",
      levels,
      probabilities: probabilitiesByLevel,
    };
    const insufficient = {
      dimensionId: "b_engagement",
      label: "对方的投入度",
      confidence: 0.2,
      status: "insufficient_evidence",
    } as const;

    const { container } = render(
      <InteractionResult
        dimensions={[available, insufficient]}
        balance={{ status: "insufficient_evidence", value: null, confidenceBand: null }}
        interactionIndex={{
          status: "insufficient_evidence",
          value: null,
          confidenceBand: null,
          includedComponents: [],
        }}
      />,
    );

    expect(screen.getByText("可能为「未观察到明显信号」")).toBeInTheDocument();
    expect(container.querySelectorAll(".level-scale > span")).toHaveLength(4);
    expect(screen.getByText("对方的投入度").closest("article")).toHaveTextContent("证据不足");
    expect(screen.getByText(/不代表关系质量或真实好感概率/)).toBeInTheDocument();
  });
});

describe("ExplanationResult", () => {
  it("依据维度分成 A、B、整体互动三组，并标记每条证据的发送者", () => {
    const messages: ChatMessage[] = [
      {
        id: "m-0001",
        senderId: "a",
        timestamp: "2026-09-18T09:00:00+08:00",
        kind: "text",
        text: "虚构消息甲",
      },
      {
        id: "m-0002",
        senderId: "b",
        timestamp: "2026-09-18T09:01:00+08:00",
        kind: "text",
        text: "虚构消息乙",
      },
    ];
    const explanation = {
      headline: "虚构互动解读",
      overview: "仅用于界面测试。",
      classificationExplanation: "场景匹配说明。",
      confidenceExplanation: "集中度说明。",
      dimensionInterpretations: [
        {
          dimensionId: "responsiveness_coordination",
          explanation: "回应协调说明。",
          evidence: [{ messageId: "m-0002", excerpt: "虚构消息乙", truncated: false }],
        },
        {
          dimensionId: "b_warmth",
          explanation: "B 的温度说明。",
          evidence: [{ messageId: "m-0002", excerpt: "虚构消息乙", truncated: false }],
        },
        {
          dimensionId: "a_engagement",
          explanation: "A 的投入说明。",
          evidence: [{ messageId: "m-0001", excerpt: "虚构消息甲", truncated: false }],
        },
      ],
      uncertainties: [],
      caveats: [],
    } satisfies ExplanationResponse["relationshipExplanation"];

    const { container } = render(
      <ExplanationResult
        explanation={explanation}
        messages={messages}
        meId="b"
        dimensions={[
          { dimensionId: "a_engagement", label: "A 的投入度" },
          { dimensionId: "b_warmth", label: "B 的表达温度" },
          { dimensionId: "responsiveness_coordination", label: "回应协调" },
        ]}
      />,
    );
    const summaries = container.querySelectorAll(".interpretation-card > p");

    expect(screen.getAllByRole("heading", { level: 4 }).map((heading) => heading.textContent)).toEqual([
      "A（对方）的分析",
      "B（我）的分析",
      "整体互动分析",
    ]);
    expect(screen.getAllByRole("heading", { level: 5 }).map((heading) => heading.textContent)).toEqual([
      "A 的投入度",
      "B 的表达温度",
      "回应协调",
    ]);
    expect(summaries[0]).toHaveTextContent("A（对方）：A 的投入说明。");
    expect(summaries[1]).toHaveTextContent("B（我）：B 的温度说明。");
    expect(summaries[2]).toHaveTextContent("整体互动：回应协调说明。");
    expect(screen.getByText("消息证据 · m-0001").closest("blockquote")).toHaveTextContent(
      "A（对方）：虚构消息甲",
    );
    for (const citation of screen.getAllByText("消息证据 · m-0002")) {
      expect(citation.closest("blockquote")).toHaveTextContent("B（我）：虚构消息乙");
    }
  });

  it("没有入选关键维度的分组保留标题，不补造分析", () => {
    const explanation = {
      headline: "虚构互动解读",
      overview: "仅用于界面测试。",
      classificationExplanation: "场景匹配说明。",
      confidenceExplanation: "集中度说明。",
      dimensionInterpretations: [
        {
          dimensionId: "responsiveness_coordination",
          explanation: "回应协调说明。",
          evidence: [{ messageId: "m-0001", excerpt: "虚构消息甲", truncated: false }],
        },
      ],
      uncertainties: [],
      caveats: [],
    } satisfies ExplanationResponse["relationshipExplanation"];
    const messages: ChatMessage[] = [
      {
        id: "m-0001",
        senderId: "a",
        timestamp: "2026-09-18T09:00:00+08:00",
        kind: "text",
        text: "虚构消息甲",
      },
    ];

    const { container } = render(
      <ExplanationResult
        explanation={explanation}
        messages={messages}
        meId="a"
        dimensions={[{ dimensionId: "responsiveness_coordination", label: "回应协调" }]}
      />,
    );

    expect(screen.getByRole("region", { name: "A（我）的分析" })).toHaveTextContent(
      "本次解读未单独展开 A 的关键维度。",
    );
    expect(screen.getByRole("region", { name: "B（对方）的分析" })).toHaveTextContent(
      "本次解读未单独展开 B 的关键维度。",
    );
    expect(screen.getByRole("region", { name: "整体互动分析" })).toHaveTextContent(
      "整体互动：回应协调说明。",
    );
    expect(screen.getByRole("heading", { level: 5, name: "回应协调" })).toBeInTheDocument();
    expect(container.querySelectorAll(".interpretation-card")).toHaveLength(1);
  });
});

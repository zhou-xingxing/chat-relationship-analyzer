import "server-only";

import type {
  ChoiceConfidenceBand,
  DimensionId,
  InteractionIndexComponentId,
  RelationshipBroadId,
  RelationshipSubtypeId,
} from "@/lib/contracts/analysis";

export const ANALYSIS_RULESET_VERSION = "2026-09-21.v1";
export const EXPLANATION_POLICY_VERSION = "2026-09-22.v2";

export const ANALYSIS_CONTEXT_VERSION = 1 as const;
export const ANALYSIS_CONTEXT_TTL_SECONDS = 10 * 60;
export const MAX_ANALYSIS_CONTEXT_TOKEN_LENGTH = 64 * 1024;
export const EVIDENCE_EXCERPT_MAX_CODE_POINTS = 500;

export const SIGNALS_DEADLINE_MS = 55_000;
export const EXPLANATION_DEADLINE_MS = 85_000;
export const TYPESAFE_PRIMARY_ATTEMPT_TIMEOUT_MS = 20_000;
export const TYPESAFE_SUBTYPE_ATTEMPT_TIMEOUT_MS = 6_000;
export const LLM_INITIAL_TIMEOUT_MS = 60_000;
export const LLM_REPAIR_TIMEOUT_MS = 20_000;
export const LLM_MAX_OUTPUT_TOKENS = 4_096;

export const DIMENSION_CONFIDENCE_THRESHOLD = 0.45;
export const HIGH_CONFIDENCE_THRESHOLD = 0.7;
export const SUBTYPE_CONFIDENCE_THRESHOLD = 0.65;
export const SUBTYPE_PROBABILITY_MARGIN_THRESHOLD = 0.15;
export const MIN_INTERACTION_INDEX_COMPONENTS = 4;

export const PROBABILITY_SUM_TOLERANCE = 0.01;
export const WEIGHT_SUM_TOLERANCE = 0.01;

export const BROAD_OPTIONS = [
  { id: "romantic_or_partner", label: "浪漫或伴侣" },
  { id: "friendship", label: "朋友" },
  { id: "family", label: "家庭" },
  { id: "work_or_education", label: "工作或学校" },
  { id: "commercial_or_service", label: "交易或服务" },
  { id: "weak_tie_or_new_contact", label: "弱关系或新联系人" },
  { id: "other", label: "其他" },
  { id: "unclear", label: "信息不足" },
] as const satisfies ReadonlyArray<{ id: RelationshipBroadId; label: string }>;

export const SUBTYPE_OPTIONS = {
  romantic_or_partner: [
    { id: "established_partner", label: "已建立伴侣关系" },
    { id: "mutual_romantic_exploration", label: "双向暧昧或试探" },
    { id: "one_sided_pursuit", label: "单向追求或投入" },
    { id: "former_partner", label: "曾经的伴侣关系" },
    { id: "romantic_unclear", label: "无法细分" },
  ],
  friendship: [
    { id: "close_friend", label: "亲密朋友" },
    { id: "ordinary_friend", label: "普通朋友" },
    { id: "new_friend", label: "新建立的朋友关系" },
    { id: "reconnecting_friend", label: "疏远或重新联系的朋友" },
    { id: "friendship_unclear", label: "无法细分" },
  ],
  family: [
    { id: "parent_child", label: "亲子" },
    { id: "siblings", label: "兄弟姐妹" },
    { id: "grandparent_grandchild", label: "祖孙" },
    { id: "other_relative", label: "其他亲属" },
    { id: "family_unclear", label: "无法细分" },
  ],
  work_or_education: [
    { id: "peer_colleagues", label: "平级同事" },
    { id: "manager_report", label: "上下级" },
    { id: "teacher_student", label: "师生或指导关系" },
    { id: "classmates", label: "同学" },
    { id: "external_collaboration", label: "外部协作关系" },
    { id: "work_or_education_unclear", label: "无法细分" },
  ],
  commercial_or_service: [
    { id: "merchant_customer", label: "商家与顾客" },
    { id: "professional_service", label: "专业服务关系" },
    { id: "customer_support", label: "平台客服或售后" },
    { id: "one_off_transaction", label: "一次性交易或办事" },
    { id: "commercial_or_service_unclear", label: "无法细分" },
  ],
  weak_tie_or_new_contact: [
    { id: "initial_contact", label: "初次联系" },
    { id: "acquaintance", label: "普通熟人" },
    { id: "community_contact", label: "社群邻里或共同圈子联系人" },
    { id: "brief_task_contact", label: "短暂事务接触" },
    { id: "weak_tie_unclear", label: "无法细分" },
  ],
} as const satisfies Partial<
  Record<RelationshipBroadId, ReadonlyArray<{ id: RelationshipSubtypeId; label: string }>>
>;

export const DIMENSION_DEFINITIONS = [
  { id: "a_engagement", label: "A 的投入度" },
  { id: "b_engagement", label: "B 的投入度" },
  { id: "a_warmth", label: "A 的表达温度" },
  { id: "b_warmth", label: "B 的表达温度" },
  { id: "responsiveness_coordination", label: "回应协调" },
  { id: "self_disclosure", label: "自我表达" },
  { id: "support_care", label: "支持关怀" },
  { id: "future_orientation", label: "未来导向" },
  { id: "tension_hostility", label: "紧张敌意" },
  { id: "power_asymmetry", label: "权力不对等" },
] as const satisfies ReadonlyArray<{ id: DimensionId; label: string }>;

export const DIMENSION_LEVELS = [
  { score: 0, label: "未观察到明显信号" },
  { score: 1, label: "少量或很弱的信号" },
  { score: 2, label: "中等、但不完全一致的信号" },
  { score: 3, label: "较多且较一致的信号" },
  { score: 4, label: "强烈且持续的信号" },
] as const;

export const INTERACTION_INDEX_WEIGHTS = {
  engagement_mean: 0.2,
  warmth_mean: 0.25,
  responsiveness_coordination: 0.2,
  self_disclosure: 0.1,
  support_care: 0.15,
  future_orientation: 0.1,
} as const satisfies Record<InteractionIndexComponentId, number>;

export const DERIVED_METRIC_LABELS = {
  interactionBalance: "互动平衡度",
  interactionIndex: "综合互动指数",
} as const;

export function getBroadLabel(id: RelationshipBroadId): string {
  return BROAD_OPTIONS.find((option) => option.id === id)!.label;
}

export function getSubtypeOptions(
  broadId: Exclude<RelationshipBroadId, "other" | "unclear">,
) {
  return SUBTYPE_OPTIONS[broadId];
}

export function getDimensionLabel(id: DimensionId): string {
  return DIMENSION_DEFINITIONS.find((definition) => definition.id === id)!.label;
}

/** Choice 的阈值与面向用户的措辞只在服务端确定，客户端直接渲染结果。 */
export function getChoiceDisplaySemantics(
  label: string,
  confidence: number,
): { summary: string; confidenceBand: ChoiceConfidenceBand } {
  if (confidence < 0.4) {
    return {
      summary: "当前线索不足，暂时无法判断",
      confidenceBand: "insufficient",
    };
  }
  if (confidence < 0.65) {
    return {
      summary: `当前更接近「${label}」，但线索还不够统一`,
      confidenceBand: "low",
    };
  }
  if (confidence <= 0.85) {
    return {
      summary: `当前最符合「${label}」`,
      confidenceBand: "medium",
    };
  }
  return {
    summary: `当前片段与「${label}」的匹配信号较集中`,
    confidenceBand: "high",
  };
}

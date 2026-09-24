import { z } from "zod";

import {
  ChatMessageSchema,
  DIMENSION_SCORES,
  DimensionScoreSchema,
  PARTICIPANT_IDS,
  ParticipantIdSchema,
  ParticipantsSchema,
  type DimensionScore,
} from "@/lib/contracts/chat";

export const RELATIONSHIP_BROAD_IDS = [
  "romantic_or_partner",
  "friendship",
  "family",
  "work_or_education",
  "commercial_or_service",
  "weak_tie_or_new_contact",
  "other",
  "unclear",
] as const;

export const RELATIONSHIP_SUBTYPE_IDS_BY_BROAD_ID = {
  romantic_or_partner: [
    "established_partner",
    "mutual_romantic_exploration",
    "one_sided_pursuit",
    "former_partner",
    "romantic_unclear",
  ],
  friendship: [
    "close_friend",
    "ordinary_friend",
    "new_friend",
    "reconnecting_friend",
    "friendship_unclear",
  ],
  family: [
    "parent_child",
    "siblings",
    "grandparent_grandchild",
    "other_relative",
    "family_unclear",
  ],
  work_or_education: [
    "peer_colleagues",
    "manager_report",
    "teacher_student",
    "classmates",
    "external_collaboration",
    "work_or_education_unclear",
  ],
  commercial_or_service: [
    "merchant_customer",
    "professional_service",
    "customer_support",
    "one_off_transaction",
    "commercial_or_service_unclear",
  ],
  weak_tie_or_new_contact: [
    "initial_contact",
    "acquaintance",
    "community_contact",
    "brief_task_contact",
    "weak_tie_unclear",
  ],
  other: [],
  unclear: [],
} as const;

export const RELATIONSHIP_SUBTYPE_IDS = [
  ...RELATIONSHIP_SUBTYPE_IDS_BY_BROAD_ID.romantic_or_partner,
  ...RELATIONSHIP_SUBTYPE_IDS_BY_BROAD_ID.friendship,
  ...RELATIONSHIP_SUBTYPE_IDS_BY_BROAD_ID.family,
  ...RELATIONSHIP_SUBTYPE_IDS_BY_BROAD_ID.work_or_education,
  ...RELATIONSHIP_SUBTYPE_IDS_BY_BROAD_ID.commercial_or_service,
  ...RELATIONSHIP_SUBTYPE_IDS_BY_BROAD_ID.weak_tie_or_new_contact,
] as const;

export const DIMENSION_IDS = [
  "a_engagement",
  "b_engagement",
  "a_warmth",
  "b_warmth",
  "responsiveness_coordination",
  "self_disclosure",
  "support_care",
  "future_orientation",
  "tension_hostility",
  "power_asymmetry",
] as const;

export const INTERACTION_INDEX_COMPONENT_IDS = [
  "engagement_mean",
  "warmth_mean",
  "responsiveness_coordination",
  "self_disclosure",
  "support_care",
  "future_orientation",
] as const;

export const RelationshipBroadIdSchema = z.enum(RELATIONSHIP_BROAD_IDS);
export type RelationshipBroadId = z.infer<typeof RelationshipBroadIdSchema>;

export const RelationshipSubtypeIdSchema = z.enum(RELATIONSHIP_SUBTYPE_IDS);
export type RelationshipSubtypeId = z.infer<typeof RelationshipSubtypeIdSchema>;

export const DimensionIdSchema = z.enum(DIMENSION_IDS);
export type DimensionId = z.infer<typeof DimensionIdSchema>;

export const InteractionIndexComponentIdSchema = z.enum(
  INTERACTION_INDEX_COMPONENT_IDS,
);
export type InteractionIndexComponentId = z.infer<
  typeof InteractionIndexComponentIdSchema
>;

const ProbabilitySchema = z.number().finite().min(0).max(1);
const ConfidenceSchema = z.number().finite().min(0).max(1);
const UserFacingLabelSchema = z.string().trim().min(1);

export const ChoiceConfidenceBandSchema = z.enum([
  "insufficient",
  "low",
  "medium",
  "high",
]);
export type ChoiceConfidenceBand = z.infer<typeof ChoiceConfidenceBandSchema>;

export const AvailableConfidenceBandSchema = z.enum(["medium", "high"]);
export type AvailableConfidenceBand = z.infer<
  typeof AvailableConfidenceBandSchema
>;

export const ChoiceProbabilitySchema = z.strictObject({
  id: z.string().min(1),
  label: UserFacingLabelSchema,
  probability: ProbabilitySchema,
});
export type ChoiceProbability = z.infer<typeof ChoiceProbabilitySchema>;

export const ChoiceResultSchema = z.strictObject({
  selectedId: z.string().min(1),
  selectedLabel: UserFacingLabelSchema,
  summary: UserFacingLabelSchema,
  confidenceBand: ChoiceConfidenceBandSchema,
  probabilities: z.array(ChoiceProbabilitySchema).min(1),
  confidence: ConfidenceSchema,
});
export type ChoiceResult<TId extends string = string> = Omit<
  z.infer<typeof ChoiceResultSchema>,
  "selectedId" | "probabilities"
> & {
  selectedId: TId;
  probabilities: Array<
    Omit<z.infer<typeof ChoiceProbabilitySchema>, "id"> & { id: TId }
  >;
};

type ChoiceLike = z.infer<typeof ChoiceResultSchema>;

function validateChoice(
  choice: ChoiceLike,
  context: z.RefinementCtx,
  requiredIds?: readonly string[],
): void {
  const seenIds = new Set<string>();
  choice.probabilities.forEach((item, index) => {
    if (seenIds.has(item.id)) {
      context.addIssue({
        code: "custom",
        path: ["probabilities", index, "id"],
        message: "概率列表中的选项不得重复",
      });
    }
    seenIds.add(item.id);
  });

  if (
    requiredIds &&
    (seenIds.size !== requiredIds.length ||
      requiredIds.some((requiredId) => !seenIds.has(requiredId)))
  ) {
    context.addIssue({
      code: "custom",
      path: ["probabilities"],
      message: "概率列表必须完整且仅包含当前结果要求的选项",
    });
  }

  const probabilitySum = choice.probabilities.reduce(
    (sum, item) => sum + item.probability,
    0,
  );
  if (Math.abs(probabilitySum - 1) > 0.01 + Number.EPSILON) {
    context.addIssue({
      code: "custom",
      path: ["probabilities"],
      message: "概率之和必须在 1±0.01 范围内",
    });
  }

  const selected = choice.probabilities.find(
    (item) => item.id === choice.selectedId,
  );
  if (!selected) {
    context.addIssue({
      code: "custom",
      path: ["selectedId"],
      message: "选中项必须存在于概率列表中",
    });
    return;
  }

  const highestProbability = Math.max(
    ...choice.probabilities.map((item) => item.probability),
  );
  if (selected.probability !== highestProbability) {
    context.addIssue({
      code: "custom",
      path: ["selectedId"],
      message: "选中项必须属于最高概率选项",
    });
  }
  if (selected.label !== choice.selectedLabel) {
    context.addIssue({
      code: "custom",
      path: ["selectedLabel"],
      message: "选中项标签必须与概率列表中的对应标签一致",
    });
  }
}

const BroadChoiceProbabilitySchema = ChoiceProbabilitySchema.extend({
  id: RelationshipBroadIdSchema,
});

export const BroadChoiceResultSchema = ChoiceResultSchema.extend({
  selectedId: RelationshipBroadIdSchema,
  probabilities: z
    .array(BroadChoiceProbabilitySchema)
    .length(RELATIONSHIP_BROAD_IDS.length),
}).superRefine((choice, context) => {
  validateChoice(choice, context, RELATIONSHIP_BROAD_IDS);
});
export type BroadChoiceResult = z.infer<typeof BroadChoiceResultSchema>;

const SubtypeChoiceProbabilitySchema = ChoiceProbabilitySchema.extend({
  id: RelationshipSubtypeIdSchema,
});

export const SubtypeChoiceResultSchema = ChoiceResultSchema.extend({
  selectedId: RelationshipSubtypeIdSchema,
  probabilities: z.array(SubtypeChoiceProbabilitySchema).min(1),
}).superRefine((choice, context) => {
  validateChoice(choice, context);
});
export type SubtypeChoiceResult = z.infer<typeof SubtypeChoiceResultSchema>;

export const DimensionLevelSchema = z.strictObject({
  score: DimensionScoreSchema,
  label: UserFacingLabelSchema,
});
export type DimensionLevel = z.infer<typeof DimensionLevelSchema>;

export const DimensionProbabilitySchema = z.strictObject({
  score: DimensionScoreSchema,
  label: UserFacingLabelSchema,
  probability: ProbabilitySchema,
});
export type DimensionProbability = z.infer<typeof DimensionProbabilitySchema>;

const DimensionResultBaseShape = {
  dimensionId: DimensionIdSchema,
  label: UserFacingLabelSchema,
  confidence: ConfidenceSchema,
};

const AvailableDimensionResultSchema = z
  .strictObject({
    ...DimensionResultBaseShape,
    status: z.literal("available"),
    confidenceBand: AvailableConfidenceBandSchema,
    score: DimensionScoreSchema,
    levels: z.array(DimensionLevelSchema).length(DIMENSION_SCORES.length),
    probabilities: z
      .array(DimensionProbabilitySchema)
      .length(DIMENSION_SCORES.length),
  })
  .superRefine((dimension, context) => {
    const levelByScore = new Map<DimensionScore, string>();
    dimension.levels.forEach((level, index) => {
      if (levelByScore.has(level.score)) {
        context.addIssue({
          code: "custom",
          path: ["levels", index, "score"],
          message: "五级量表不得包含重复等级",
        });
      }
      levelByScore.set(level.score, level.label);
    });
    if (DIMENSION_SCORES.some((score) => !levelByScore.has(score))) {
      context.addIssue({
        code: "custom",
        path: ["levels"],
        message: "五级量表必须完整包含 0～4",
      });
    }

    const probabilityScores = new Set<DimensionScore>();
    dimension.probabilities.forEach((item, index) => {
      if (probabilityScores.has(item.score)) {
        context.addIssue({
          code: "custom",
          path: ["probabilities", index, "score"],
          message: "等级概率不得包含重复等级",
        });
      }
      probabilityScores.add(item.score);
      if (levelByScore.get(item.score) !== item.label) {
        context.addIssue({
          code: "custom",
          path: ["probabilities", index, "label"],
          message: "等级概率标签必须与五级量表一致",
        });
      }
    });
    if (DIMENSION_SCORES.some((score) => !probabilityScores.has(score))) {
      context.addIssue({
        code: "custom",
        path: ["probabilities"],
        message: "等级概率必须完整包含 0～4",
      });
    }

    const probabilitySum = dimension.probabilities.reduce(
      (sum, item) => sum + item.probability,
      0,
    );
    if (Math.abs(probabilitySum - 1) > 0.01 + Number.EPSILON) {
      context.addIssue({
        code: "custom",
        path: ["probabilities"],
        message: "等级概率之和必须在 1±0.01 范围内",
      });
    }

    const selectedProbability = dimension.probabilities.find(
      (item) => item.score === dimension.score,
    );
    const highestProbability = Math.max(
      ...dimension.probabilities.map((item) => item.probability),
    );
    if (selectedProbability?.probability !== highestProbability) {
      context.addIssue({
        code: "custom",
        path: ["score"],
        message: "维度得分必须属于最高概率等级",
      });
    }
  });

const InsufficientDimensionResultSchema = z.strictObject({
  ...DimensionResultBaseShape,
  status: z.literal("insufficient_evidence"),
});

export const DimensionResultSchema = z.discriminatedUnion("status", [
  AvailableDimensionResultSchema,
  InsufficientDimensionResultSchema,
]);
export type DimensionResult = z.infer<typeof DimensionResultSchema>;

const AvailableSubtypeResultSchema = z.strictObject({
  status: z.literal("available"),
  result: SubtypeChoiceResultSchema,
});

const SkippedSubtypeResultSchema = z.strictObject({
  status: z.literal("skipped"),
  reason: z.enum([
    "broad_unclear_or_other",
    "low_confidence",
    "small_probability_margin",
  ]),
});

const UnavailableSubtypeResultSchema = z.strictObject({
  status: z.literal("temporarily_unavailable"),
});

export const SubtypeResultSchema = z.discriminatedUnion("status", [
  AvailableSubtypeResultSchema,
  SkippedSubtypeResultSchema,
  UnavailableSubtypeResultSchema,
]);
export type SubtypeResult = z.infer<typeof SubtypeResultSchema>;

const AvailableDerivedMetricSchema = z.strictObject({
  status: z.literal("available"),
  value: z.number().finite().min(0).max(100),
  label: UserFacingLabelSchema,
  confidenceBand: z.enum(["medium", "high"]),
});

const InsufficientDerivedMetricSchema = z.strictObject({
  status: z.literal("insufficient_evidence"),
  value: z.null(),
  confidenceBand: z.null(),
});

export const DerivedMetricSchema = z.discriminatedUnion("status", [
  AvailableDerivedMetricSchema,
  InsufficientDerivedMetricSchema,
]);
export type DerivedMetric = z.infer<typeof DerivedMetricSchema>;

export const InteractionIndexComponentSchema = z.strictObject({
  componentId: InteractionIndexComponentIdSchema,
  effectiveWeight: z.number().finite().min(0).max(1),
});
export type InteractionIndexComponent = z.infer<
  typeof InteractionIndexComponentSchema
>;

const AvailableInteractionIndexMetricSchema = z
  .strictObject({
    status: z.literal("available"),
    value: z.number().finite().min(0).max(100),
    label: UserFacingLabelSchema,
    confidenceBand: z.enum(["medium", "high"]),
    includedComponents: z.array(InteractionIndexComponentSchema).min(4),
  })
  .superRefine((metric, context) => {
    const componentIds = new Set<InteractionIndexComponentId>();
    metric.includedComponents.forEach((component, index) => {
      if (componentIds.has(component.componentId)) {
        context.addIssue({
          code: "custom",
          path: ["includedComponents", index, "componentId"],
          message: "互动指数组件不得重复",
        });
      }
      componentIds.add(component.componentId);
    });

    const weightSum = metric.includedComponents.reduce(
      (sum, component) => sum + component.effectiveWeight,
      0,
    );
    if (Math.abs(weightSum - 1) > 0.01 + Number.EPSILON) {
      context.addIssue({
        code: "custom",
        path: ["includedComponents"],
        message: "互动指数组件的生效权重之和必须在 1±0.01 范围内",
      });
    }
  });

const InsufficientInteractionIndexMetricSchema = z.strictObject({
  status: z.literal("insufficient_evidence"),
  value: z.null(),
  confidenceBand: z.null(),
  includedComponents: z.tuple([]),
});

export const InteractionIndexMetricSchema = z.discriminatedUnion("status", [
  AvailableInteractionIndexMetricSchema,
  InsufficientInteractionIndexMetricSchema,
]);
export type InteractionIndexMetric = z.infer<
  typeof InteractionIndexMetricSchema
>;

export const RelationshipClassificationSchema = z
  .strictObject({
    broad: BroadChoiceResultSchema,
    subtype: SubtypeResultSchema,
    notGroundTruth: z.literal(true),
  })
  .superRefine((classification, context) => {
    if (classification.subtype.status !== "available") {
      return;
    }

    const expectedIds = RELATIONSHIP_SUBTYPE_IDS_BY_BROAD_ID[
      classification.broad.selectedId
    ] as readonly string[];
    const actualIds = new Set<string>(
      classification.subtype.result.probabilities.map((item) => item.id),
    );
    if (
      expectedIds.length === 0 ||
      actualIds.size !== expectedIds.length ||
      expectedIds.some((expectedId) => !actualIds.has(expectedId))
    ) {
      context.addIssue({
        code: "custom",
        path: ["subtype", "result", "probabilities"],
        message: "可用细分必须完整且仅包含当前主导场景定义的选项",
      });
    }
  });
export type RelationshipClassification = z.infer<
  typeof RelationshipClassificationSchema
>;

function validateMessages(
  messages: z.infer<typeof ChatMessageSchema>[],
  context: z.RefinementCtx,
): void {
  const messageIds = new Set<string>();
  const senderIds = new Set<string>();
  messages.forEach((message, index) => {
    if (messageIds.has(message.id)) {
      context.addIssue({
        code: "custom",
        path: ["messages", index, "id"],
        message: "消息 ID 在本次请求中必须唯一",
      });
    }
    messageIds.add(message.id);
    senderIds.add(message.senderId);
  });
  if (PARTICIPANT_IDS.some((participantId) => !senderIds.has(participantId))) {
    context.addIssue({
      code: "custom",
      path: ["messages"],
      message: "结构化聊天必须同时包含两位参与者的消息",
    });
  }
}

export const SignalAnalysisRequestSchema = z
  .strictObject({
    participants: ParticipantsSchema,
    messages: z.array(ChatMessageSchema).min(1),
  })
  .superRefine((request, context) => {
    validateMessages(request.messages, context);
  });
export type SignalAnalysisRequest = z.infer<typeof SignalAnalysisRequestSchema>;

export const DeterministicMetricsSchema = z.strictObject({
  messageCount: z.number().int().nonnegative(),
  normalizedCharacterCount: z.number().int().nonnegative(),
  participantMessageCounts: z.strictObject({
    a: z.number().int().nonnegative(),
    b: z.number().int().nonnegative(),
  }),
  participantMessageShares: z.strictObject({
    a: ProbabilitySchema,
    b: ProbabilitySchema,
  }),
});
export type DeterministicMetrics = z.infer<
  typeof DeterministicMetricsSchema
>;

const ModelVersionsSchema = z.strictObject({
  typesafe: z.string().min(1),
});

function validateDimensions(
  dimensions: DimensionResult[],
  context: z.RefinementCtx,
): void {
  const dimensionIds = new Set(dimensions.map((item) => item.dimensionId));
  if (
    dimensionIds.size !== DIMENSION_IDS.length ||
    DIMENSION_IDS.some((dimensionId) => !dimensionIds.has(dimensionId))
  ) {
    context.addIssue({
      code: "custom",
      path: ["dimensions"],
      message: "十个互动维度必须恰好各出现一次",
    });
  }
}

export const SignalAnalysisResponseSchema = z
  .strictObject({
    relationshipClassification: RelationshipClassificationSchema,
    dimensions: z.array(DimensionResultSchema).length(DIMENSION_IDS.length),
    derivedSignals: z.strictObject({
      interactionBalance: DerivedMetricSchema,
    }),
    interactionIndex: InteractionIndexMetricSchema,
    analysisContext: z.string().min(1),
    meta: z.strictObject({
      requestId: z.string().min(1),
      messageCount: z.number().int().nonnegative(),
      modelVersions: ModelVersionsSchema,
      analysisRulesetVersion: z.string().min(1),
      explanationPolicyVersion: z.string().min(1),
      analysisContextExpiresAt: z.number().int().nonnegative(),
    }),
  })
  .superRefine((response, context) => {
    validateDimensions(response.dimensions, context);
  });
export type SignalAnalysisResponse = z.infer<
  typeof SignalAnalysisResponseSchema
>;

export const AnalysisContextPayloadSchema = z
  .strictObject({
    version: z.literal(1),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    participants: ParticipantsSchema,
    messageDigest: z.string().min(1),
    deterministicMetrics: DeterministicMetricsSchema,
    relationshipClassification: RelationshipClassificationSchema,
    dimensions: z.array(DimensionResultSchema).length(DIMENSION_IDS.length),
    derivedSignals: z.strictObject({
      interactionBalance: DerivedMetricSchema,
    }),
    interactionIndex: InteractionIndexMetricSchema,
    modelVersions: ModelVersionsSchema,
    analysisRulesetVersion: z.string().min(1),
    explanationPolicyVersion: z.string().min(1),
  })
  .superRefine((payload, context) => {
    if (payload.expiresAt <= payload.issuedAt) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "分析上下文过期时间必须晚于签发时间",
      });
    }
    validateDimensions(payload.dimensions, context);
  });
export type AnalysisContextPayload = z.infer<
  typeof AnalysisContextPayloadSchema
>;

export const ExplanationRequestSchema = z
  .strictObject({
    participants: ParticipantsSchema,
    messages: z.array(ChatMessageSchema).min(1),
    analysisContext: z.string().min(1),
  })
  .superRefine((request, context) => {
    validateMessages(request.messages, context);
  });
export type ExplanationRequest = z.infer<typeof ExplanationRequestSchema>;

/**
 * 每个关键维度解释最多引用的原文证据条数。
 * 模型实测自然引用 2～4 条；上限设为 5 是留出余量，避免为了一个计数差异
 * 让整份解读作废。响应契约与模型输出校验共用此常量，提示词也从这里取值。
 */
export const EVIDENCE_MAX_ITEMS = 5;

export const EvidenceExcerptSchema = z
  .strictObject({
    messageId: z.string().min(1),
    excerpt: z.string(),
    truncated: z.boolean(),
  })
  .superRefine((evidence, context) => {
    if ([...evidence.excerpt].length > 500) {
      context.addIssue({
        code: "custom",
        path: ["excerpt"],
        message: "证据摘录不得超过 500 个 Unicode code point",
      });
    }
  });
export type EvidenceExcerpt = z.infer<typeof EvidenceExcerptSchema>;

export const DimensionInterpretationSchema = z
  .strictObject({
    dimensionId: DimensionIdSchema,
    evidence: z.array(EvidenceExcerptSchema).min(1).max(EVIDENCE_MAX_ITEMS),
    explanation: z.string().trim().min(1),
  })
  .superRefine((interpretation, context) => {
    const messageIds = new Set<string>();
    interpretation.evidence.forEach((evidence, index) => {
      if (messageIds.has(evidence.messageId)) {
        context.addIssue({
          code: "custom",
          path: ["evidence", index, "messageId"],
          message: "同一维度的证据消息不得重复",
        });
      }
      messageIds.add(evidence.messageId);
    });
  });
export type DimensionInterpretation = z.infer<
  typeof DimensionInterpretationSchema
>;

export const ExplanationResponseSchema = z
  .strictObject({
    relationshipExplanation: z.strictObject({
      headline: z.string().trim().min(1),
      overview: z.string().trim().min(1),
      classificationExplanation: z.string().trim().min(1),
      confidenceExplanation: z.string().trim().min(1),
      dimensionInterpretations: z
        .array(DimensionInterpretationSchema)
        .min(1)
        .max(DIMENSION_IDS.length),
      uncertainties: z.array(z.string().trim().min(1)),
      caveats: z.array(z.string().trim().min(1)),
    }),
    meta: z.strictObject({
      requestId: z.string().min(1),
      messageCount: z.number().int().nonnegative(),
      modelVersions: z.strictObject({ llm: z.string().min(1) }),
      analysisRulesetVersion: z.string().min(1),
      explanationPolicyVersion: z.string().min(1),
    }),
  })
  .superRefine((response, context) => {
    const dimensionIds = new Set<DimensionId>();
    response.relationshipExplanation.dimensionInterpretations.forEach(
      (interpretation, index) => {
        if (dimensionIds.has(interpretation.dimensionId)) {
          context.addIssue({
            code: "custom",
            path: [
              "relationshipExplanation",
              "dimensionInterpretations",
              index,
              "dimensionId",
            ],
            message: "关键维度解释不得重复",
          });
        }
        dimensionIds.add(interpretation.dimensionId);
      },
    );
  });
export type ExplanationResponse = z.infer<typeof ExplanationResponseSchema>;

// 供签名载荷或测试构造精确的参与者映射时复用。
export const ParticipantRecordSchema = z.record(
  ParticipantIdSchema,
  z.number().nonnegative(),
).refine((record) => PARTICIPANT_IDS.every((id) => id in record), {
  message: "参与者映射必须同时包含 a 与 b",
});

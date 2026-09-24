import "server-only";

import type { DimensionScore } from "@/lib/contracts/chat";
import type {
  DerivedMetric,
  DimensionId,
  DimensionResult,
  InteractionIndexComponentId,
  InteractionIndexMetric,
} from "@/lib/contracts/analysis";
import {
  DERIVED_METRIC_LABELS,
  DIMENSION_CONFIDENCE_THRESHOLD,
  DIMENSION_LEVELS,
  HIGH_CONFIDENCE_THRESHOLD,
  INTERACTION_INDEX_WEIGHTS,
  MIN_INTERACTION_INDEX_COMPONENTS,
  getDimensionLabel,
} from "./ruleset";

export interface TrustedDimensionAssessment {
  dimensionId: DimensionId;
  score: DimensionScore;
  confidence: number;
  probabilities: Array<{ score: DimensionScore; probability: number }>;
}

function confidenceBand(confidence: number): "medium" | "high" {
  return confidence > HIGH_CONFIDENCE_THRESHOLD ? "high" : "medium";
}

export function applyDimensionConfidence(
  assessment: TrustedDimensionAssessment,
): DimensionResult {
  const base = {
    dimensionId: assessment.dimensionId,
    label: getDimensionLabel(assessment.dimensionId),
    confidence: assessment.confidence,
  };

  if (assessment.confidence < DIMENSION_CONFIDENCE_THRESHOLD) {
    return { ...base, status: "insufficient_evidence" };
  }

  return {
    ...base,
    status: "available",
    confidenceBand: confidenceBand(assessment.confidence),
    score: assessment.score,
    levels: DIMENSION_LEVELS.map((level) => ({ ...level })),
    probabilities: assessment.probabilities.map((probability) => ({
      ...probability,
      label: DIMENSION_LEVELS[probability.score].label,
    })),
  };
}

function getAvailableDimension(
  dimensions: readonly DimensionResult[],
  id: DimensionId,
): Extract<DimensionResult, { status: "available" }> | undefined {
  const result = dimensions.find((dimension) => dimension.dimensionId === id);
  return result?.status === "available" ? result : undefined;
}

export function computeInteractionBalance(
  dimensions: readonly DimensionResult[],
): DerivedMetric {
  const requiredIds = ["a_engagement", "b_engagement", "a_warmth", "b_warmth"] as const;
  const required = requiredIds.map((id) => getAvailableDimension(dimensions, id));

  if (required.some((dimension) => dimension === undefined)) {
    return { status: "insufficient_evidence", value: null, confidenceBand: null };
  }

  const [aEngagement, bEngagement, aWarmth, bWarmth] = required as Array<
    Extract<DimensionResult, { status: "available" }>
  >;
  const engagementDifference = Math.abs(aEngagement.score / 4 - bEngagement.score / 4);
  const warmthDifference = Math.abs(aWarmth.score / 4 - bWarmth.score / 4);
  const value = Math.max(0, Math.min(100, 100 * (1 - (engagementDifference + warmthDifference) / 2)));
  const minimumConfidence = Math.min(...required.map((dimension) => dimension!.confidence));

  return {
    status: "available",
    value: Math.round(value),
    label: DERIVED_METRIC_LABELS.interactionBalance,
    confidenceBand: confidenceBand(minimumConfidence),
  };
}

interface ComponentValue {
  componentId: InteractionIndexComponentId;
  normalizedScore: number;
  confidence: number;
}

function buildIndexComponents(dimensions: readonly DimensionResult[]): ComponentValue[] {
  const aEngagement = getAvailableDimension(dimensions, "a_engagement");
  const bEngagement = getAvailableDimension(dimensions, "b_engagement");
  const aWarmth = getAvailableDimension(dimensions, "a_warmth");
  const bWarmth = getAvailableDimension(dimensions, "b_warmth");
  const components: ComponentValue[] = [];

  if (aEngagement && bEngagement) {
    components.push({
      componentId: "engagement_mean",
      normalizedScore: (aEngagement.score + bEngagement.score) / 8,
      confidence: Math.min(aEngagement.confidence, bEngagement.confidence),
    });
  }
  if (aWarmth && bWarmth) {
    components.push({
      componentId: "warmth_mean",
      normalizedScore: (aWarmth.score + bWarmth.score) / 8,
      confidence: Math.min(aWarmth.confidence, bWarmth.confidence),
    });
  }

  for (const dimensionId of [
    "responsiveness_coordination",
    "self_disclosure",
    "support_care",
    "future_orientation",
  ] as const) {
    const dimension = getAvailableDimension(dimensions, dimensionId);
    if (dimension) {
      components.push({
        componentId: dimensionId,
        normalizedScore: dimension.score / 4,
        confidence: dimension.confidence,
      });
    }
  }

  return components;
}

export function computeInteractionIndex(
  dimensions: readonly DimensionResult[],
): InteractionIndexMetric {
  const components = buildIndexComponents(dimensions);
  if (components.length < MIN_INTERACTION_INDEX_COMPONENTS) {
    return {
      status: "insufficient_evidence",
      value: null,
      confidenceBand: null,
      includedComponents: [],
    };
  }

  const includedWeight = components.reduce(
    (sum, component) => sum + INTERACTION_INDEX_WEIGHTS[component.componentId],
    0,
  );
  const includedComponents = components.map((component) => ({
    componentId: component.componentId,
    effectiveWeight: INTERACTION_INDEX_WEIGHTS[component.componentId] / includedWeight,
  }));
  const normalizedValue = components.reduce(
    (sum, component) =>
      sum +
      component.normalizedScore *
        (INTERACTION_INDEX_WEIGHTS[component.componentId] / includedWeight),
    0,
  );
  const minimumConfidence = Math.min(...components.map((component) => component.confidence));

  return {
    status: "available",
    value: Math.round(Math.max(0, Math.min(100, normalizedValue * 100))),
    label: DERIVED_METRIC_LABELS.interactionIndex,
    confidenceBand: confidenceBand(minimumConfidence),
    includedComponents,
  };
}

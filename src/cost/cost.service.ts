import type { CostBreakdown, ModelPricing } from "./cost.types.js";
import type { ProviderPricingService } from "./provider-pricing.js";

/** One micro-USD = $0.000001. Accumulate as integers to reduce FP drift. */
export function usdToMicros(usd: number): number {
  return Math.round(usd * 1_000_000);
}

export function microsToUsd(micros: number): number {
  return Math.round(micros) / 1_000_000;
}

/**
 * tokens * pricePer1M / 1e6 dollars → micros = round(tokens * pricePer1M)
 */
export function tokenCostMicros(tokens: number, pricePer1M: number): number {
  if (!Number.isFinite(tokens) || tokens < 0) return 0;
  if (!Number.isFinite(pricePer1M) || pricePer1M < 0) return 0;
  return Math.round(tokens * pricePer1M);
}

export function calculateFromPricing(
  inputTokens: number,
  outputTokens: number,
  pricing: ModelPricing,
): CostBreakdown {
  const inputMicros = tokenCostMicros(inputTokens, pricing.inputPer1M);
  const outputMicros = tokenCostMicros(outputTokens, pricing.outputPer1M);
  return {
    inputCostUsd: microsToUsd(inputMicros),
    outputCostUsd: microsToUsd(outputMicros),
    totalCostUsd: microsToUsd(inputMicros + outputMicros),
  };
}

/**
 * Cost calculation from configurable provider pricing.
 */
export class CostService {
  constructor(private readonly pricing: ProviderPricingService) {}

  calculate(input: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
  }): CostBreakdown {
    const pricing = this.pricing.getModelPricing(input.provider, input.model);
    return calculateFromPricing(input.inputTokens, input.outputTokens, pricing);
  }

  /**
   * Conservative pre-execution estimate when exact tokens unknown.
   * Uses provided token estimates or a fixed conservative default.
   */
  estimate(input: {
    provider: string;
    model: string;
    estimatedInputTokens?: number;
    estimatedOutputTokens?: number;
  }): CostBreakdown {
    const inputTokens = input.estimatedInputTokens ?? 4_000;
    const outputTokens = input.estimatedOutputTokens ?? 2_000;
    return this.calculate({
      provider: input.provider,
      model: input.model,
      inputTokens,
      outputTokens,
    });
  }
}

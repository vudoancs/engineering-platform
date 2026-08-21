import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { CostConfigurationError, UnknownModelPricingError } from "./cost-errors.js";
import type { ModelPricing, ProviderPricingConfig } from "./cost.types.js";

/**
 * Loads configurable provider/model pricing from YAML.
 * Never hard-code prices in TypeScript business logic.
 */
export class ProviderPricingService {
  private readonly config: ProviderPricingConfig;

  constructor(config: ProviderPricingConfig) {
    this.config = config;
  }

  static loadFromFile(filePath: string): ProviderPricingService {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      throw new CostConfigurationError(`Missing provider pricing file: ${resolved}`);
    }
    let raw: unknown;
    try {
      raw = parseYaml(fs.readFileSync(resolved, "utf8"));
    } catch (error) {
      throw new CostConfigurationError("Failed to parse provider-pricing.yaml", {
        cause: String(error),
      });
    }
    return new ProviderPricingService(validatePricingConfig(raw));
  }

  static loadFromDirectory(policiesDir: string): ProviderPricingService {
    return ProviderPricingService.loadFromFile(
      path.join(policiesDir, "provider-pricing.yaml"),
    );
  }

  getModelPricing(provider: string, model: string): ModelPricing {
    const p = this.config.providers[provider];
    if (!p) {
      throw new UnknownModelPricingError(provider, model);
    }
    const pricing = p.models[model];
    if (!pricing) {
      throw new UnknownModelPricingError(provider, model);
    }
    return pricing;
  }

  listProviders(): string[] {
    return Object.keys(this.config.providers);
  }
}

function validatePricingConfig(raw: unknown): ProviderPricingConfig {
  if (!raw || typeof raw !== "object" || !("providers" in raw)) {
    throw new CostConfigurationError("provider-pricing.yaml must define providers");
  }
  const providersRaw = (raw as { providers: unknown }).providers;
  if (!providersRaw || typeof providersRaw !== "object") {
    throw new CostConfigurationError("providers must be an object");
  }

  const providers: ProviderPricingConfig["providers"] = {};
  for (const [providerId, providerVal] of Object.entries(
    providersRaw as Record<string, unknown>,
  )) {
    if (!providerVal || typeof providerVal !== "object" || !("models" in providerVal)) {
      throw new CostConfigurationError(`Provider "${providerId}" must define models`);
    }
    const modelsRaw = (providerVal as { models: unknown }).models;
    if (!modelsRaw || typeof modelsRaw !== "object") {
      throw new CostConfigurationError(`Provider "${providerId}" models must be an object`);
    }
    const models: Record<string, ModelPricing> = {};
    for (const [modelId, modelVal] of Object.entries(
      modelsRaw as Record<string, unknown>,
    )) {
      if (!modelVal || typeof modelVal !== "object") {
        throw new CostConfigurationError(`Invalid model pricing: ${providerId}/${modelId}`);
      }
      const m = modelVal as Record<string, unknown>;
      const inputPer1M = Number(m.inputPer1M);
      const outputPer1M = Number(m.outputPer1M);
      if (!Number.isFinite(inputPer1M) || !Number.isFinite(outputPer1M)) {
        throw new CostConfigurationError(
          `Model ${providerId}/${modelId} requires numeric inputPer1M/outputPer1M`,
        );
      }
      if (inputPer1M < 0 || outputPer1M < 0) {
        throw new CostConfigurationError(
          `Model ${providerId}/${modelId} prices must be non-negative`,
        );
      }
      models[modelId] = { inputPer1M, outputPer1M };
    }
    providers[providerId] = { models };
  }

  return { providers };
}

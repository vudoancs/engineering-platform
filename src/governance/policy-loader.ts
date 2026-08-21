import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { GovernanceConfigurationError } from "./governance.errors.js";
import {
  validateApprovalRulesPolicy,
  validateGovernanceConfig,
  validatePermissionsPolicy,
} from "./policy-validator.js";
import type { LoadedPolicies } from "./policy.types.js";

export interface PolicyLoaderOptions {
  policiesDir: string;
}

/**
 * Loads and validates governance YAML. Invalid configuration throws (fail closed).
 * Never falls back to permissive defaults.
 */
export class PolicyLoader {
  private readonly policiesDir: string;

  constructor(options: PolicyLoaderOptions) {
    this.policiesDir = path.resolve(options.policiesDir);
  }

  load(): LoadedPolicies {
    if (!fs.existsSync(this.policiesDir)) {
      throw new GovernanceConfigurationError(
        `Policies directory not found: ${this.policiesDir}`,
        { details: { policiesDir: this.policiesDir } },
      );
    }

    const permissions = validatePermissionsPolicy(
      this.readYaml("permissions.yaml"),
    );
    const approvalRules = validateApprovalRulesPolicy(
      this.readYaml("approval-rules.yaml"),
    );
    const governance = validateGovernanceConfig(this.readYaml("governance.yaml"));

    return {
      permissions,
      approvalRules,
      governance,
      policiesDir: this.policiesDir,
    };
  }

  private readYaml(fileName: string): unknown {
    const filePath = path.join(this.policiesDir, fileName);
    if (!fs.existsSync(filePath)) {
      throw new GovernanceConfigurationError(
        `Missing required policy file: ${fileName}`,
        { details: { file: fileName, policiesDir: this.policiesDir } },
      );
    }

    let text: string;
    try {
      text = fs.readFileSync(filePath, "utf8");
    } catch (error) {
      throw new GovernanceConfigurationError(
        `Failed to read policy file: ${fileName}`,
        { cause: error, details: { file: fileName } },
      );
    }

    try {
      return parseYaml(text);
    } catch (error) {
      throw new GovernanceConfigurationError(
        `Failed to parse YAML in ${fileName}`,
        { cause: error, details: { file: fileName } },
      );
    }
  }
}
